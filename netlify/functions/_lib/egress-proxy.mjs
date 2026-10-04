// A private proxy for one website scan. Chromium must not resolve a checked
// hostname again: every CONNECT is resolved here and connected to the exact
// public IP that passed the check. HTTPS stays encrypted end to end; this
// proxy never sees page contents, cookies or TLS credentials.
import { createServer } from 'node:http'
import { connect as tcpConnect, isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isPublicAddress } from './safe-fetch.mjs'

function tunnelHost(authority) {
  // CONNECT uses authority-form, not a URL. Reject credentials, paths,
  // escaped hostnames, alternate ports and ambiguous parser inputs.
  if (typeof authority !== 'string' || !/^(?:\[[0-9a-f:]+\]|[a-z0-9.-]+):443$/i.test(authority)) return null
  let target
  try { target = new URL(`https://${authority}`) } catch { return null }
  return target.hostname.replace(/^\[|\]$/g, '')
}

export async function createEgressProxy({ lookup = dnsLookup, connect = tcpConnect, timeoutMs = 8000 } = {}) {
  const sockets = new Set()
  let closed = false
  const track = socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    // An untrusted server closing a tunnel must never crash the scan process.
    socket.on('error', () => {})
    return socket
  }
  // Plain HTTP (including ws:// upgrades) is never forwarded.
  const server = createServer((request, response) => {
    response.writeHead(403, { Connection: 'close', 'Content-Length': '0' })
    response.end()
  })
  server.maxConnections = 128
  server.headersTimeout = timeoutMs
  server.requestTimeout = timeoutMs
  server.on('connection', socket => track(socket))
  server.on('upgrade', (_request, socket) => socket.destroy())
  server.on('clientError', (_error, socket) => socket.destroy())
  server.on('connect', (request, client, head) => {
    let upstream = null, stopped = false
    const stop = () => {
      stopped = true
      clearTimeout(timer)
      upstream?.destroy()
      client.destroy()
    }
    const deny = () => {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      upstream?.destroy()
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
    }
    // One deadline includes both DNS and TCP establishment. A late DNS answer
    // cannot open a socket after the client/page/scan has already gone away.
    const timer = setTimeout(stop, timeoutMs)
    client.once('close', stop)
    client.pause()
    Promise.resolve().then(async () => {
      const hostname = tunnelHost(request.url)
      if (!hostname) return deny()
      const family = isIP(hostname)
      const records = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true, verbatim: true })
      if (!records.length || records.some(record => !isPublicAddress(record.address))) return deny()
      if (closed || stopped || client.destroyed) return stop()
      // Supplying a numeric IP means net.connect never resolves the hostname.
      // Re-check on EVERY tunnel, not once per hostname or per browser page.
      const address = records[0].address
      upstream = track(connect({ host: address, family: isIP(address), port: 443 }))
      upstream.once('error', stop)
      upstream.once('close', stop)
      upstream.once('connect', () => {
        if (closed || stopped || client.destroyed) return stop()
        clearTimeout(timer)
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
        client.resume()
      })
    }).catch(deny)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      if (closed) return
      closed = true
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

// Chrome's HTTP proxy also carries worker fetches and WebSockets. There is no
// DIRECT fallback, and <-loopback> removes Chrome's implicit bypass for local
// and link-local destinations. DNS for proxy requests happens at this proxy.
// https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md
export const egressFlags = proxyUrl => [
  `--proxy-server=${proxyUrl}`,
  '--proxy-bypass-list=<-loopback>',
  '--disable-quic',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
]
