import assert from 'node:assert/strict'
import test from 'node:test'
import { connect, createServer } from 'node:net'
import { createEgressProxy, egressFlags } from '../netlify/functions/_lib/egress-proxy.mjs'

async function fixture(t, lookup) {
  const peers = new Set()
  const target = createServer(socket => {
    peers.add(socket)
    socket.once('close', () => peers.delete(socket))
    socket.pipe(socket)
  })
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve))
  const connections = []
  const proxy = await createEgressProxy({ lookup, connect: options => {
    connections.push(options)
    // The production connector receives the validated public IP. Only this
    // test connector routes it into the local echo fixture; no public traffic.
    return connect({ host: '127.0.0.1', port: target.address().port })
  } })
  t.after(async () => {
    await proxy.close()
    for (const socket of peers) socket.destroy()
    await new Promise(resolve => target.close(resolve))
  })
  return { proxy, connections }
}

function request(proxy, raw, until = '\r\n\r\n') {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port: new URL(proxy.url).port })
    let response = ''
    socket.setTimeout(1000, () => socket.destroy(new Error('local proxy test timed out')))
    socket.once('error', reject)
    socket.on('data', chunk => {
      response += chunk.toString()
      if (response.includes(until)) { socket.destroy(); resolve(response) }
    })
    socket.once('close', () => resolve(response))
    socket.once('connect', () => socket.write(raw))
  })
}
const tunnel = (proxy, authority, body = '') => request(proxy, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n${body}`, body || '\r\n\r\n')

test('browser egress pins public DNS to the TCP socket and checks every new tunnel', async t => {
  let lookups = 0
  const { proxy, connections } = await fixture(t, async () => [{ address: ++lookups === 1 ? '1.1.1.1' : '127.0.0.1', family: 4 }])
  const first = await tunnel(proxy, 'rebinding.example.net:443', 'local echo')
  assert.match(first, /^HTTP\/1.1 200/)
  assert.match(first, /local echo$/)
  const second = await tunnel(proxy, 'rebinding.example.net:443')
  assert.match(second, /^HTTP\/1.1 403/)
  assert.equal(lookups, 2, 'a previous public DNS answer is never reused for a new connection')
  assert.deepEqual(connections, [{ host: '1.1.1.1', family: 4, port: 443 }], 'the connector receives an IP, never the attacker-controlled hostname')
})

test('private, mixed, special-use and malformed destinations never open a tunnel', async t => {
  const { proxy, connections } = await fixture(t, async hostname => hostname === 'mixed.example.net'
    ? [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }]
    : [{ address: '169.254.169.254', family: 4 }])
  for (const authority of ['private.example.net:443', 'mixed.example.net:443', '127.0.0.1:443', '[::1]:443',
    '[::ffff:127.0.0.1]:443', 'public.example.net:80', 'public.example.net:8443', 'user@public.example.net:443',
    'public.example.net:443/path', 'public.example.net%3a443:443']) {
    assert.match(await tunnel(proxy, authority), /^HTTP\/1.1 403/, authority)
  }
  assert.match(await request(proxy, 'GET http://public.example.net/ HTTP/1.1\r\nHost: public.example.net\r\n\r\n'), /^HTTP\/1.1 403/)
  assert.deepEqual(connections, [])
})

test('closing the proxy prevents late DNS answers from opening new sockets', async () => {
  let finishLookup, connections = 0
  const proxy = await createEgressProxy({ lookup: () => new Promise(resolve => { finishLookup = resolve }),
    connect: () => { connections++; throw new Error('must never connect') } })
  const pending = tunnel(proxy, 'late.example.net:443')
  while (!finishLookup) await new Promise(resolve => setImmediate(resolve))
  await proxy.close()
  finishLookup([{ address: '1.1.1.1', family: 4 }])
  await pending
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(connections, 0)
})

test('browser proxy flags remove implicit local bypass without a direct fallback', () => {
  const flags = egressFlags('http://127.0.0.1:12345')
  assert.ok(flags.includes('--proxy-server=http://127.0.0.1:12345'))
  assert.ok(flags.includes('--proxy-bypass-list=<-loopback>'))
  assert.ok(flags.includes('--disable-quic'))
  assert.ok(!flags.some(flag => /direct:\/\//.test(flag)))
})
