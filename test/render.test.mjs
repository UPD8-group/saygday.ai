import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import chromium from '@sparticuz/chromium-min'
import { requestPolicy, safeFlags, createRenderer } from '../netlify/functions/_lib/render.mjs'
import { crawlWebsite, runScan, SCAN_LIMITS } from '../netlify/functions/_lib/scan.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'

const ORIGIN = 'https://joescafe.com.au'
const DNS = { 'joescafe.com.au': ['203.17.1.10'], 'cdn.joescafe.com.au': ['203.17.1.11'], 'fonts.example.net': ['151.101.1.1'],
  'inside.joescafe.com.au': ['10.0.0.8'], 'mixed.example.net': ['151.101.1.2', '127.0.0.1'], 'meta.example.net': ['169.254.169.254'] }
const lookup = async host => { if (!DNS[host]) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); return DNS[host].map(address => ({ address, family: 4 })) }

test('the browser may only fetch public HTTPS addresses, never media, and stays on the business’s website', async () => {
  const allowed = requestPolicy({ origin: ORIGIN, lookup })
  const ask = (url, resourceType = 'script', extra = {}) => allowed({ url, resourceType, navigation: false, mainFrame: false, ...extra })
  assert.equal(await ask(`${ORIGIN}/`, 'document', { navigation: true, mainFrame: true }), true)
  assert.equal(await ask('https://cdn.joescafe.com.au/app.js'), true, 'its own scripts and data load')
  assert.equal(await ask('https://fonts.example.net/api.js', 'fetch'), true)
  for (const [url, why] of [
    ['https://inside.joescafe.com.au/admin', 'a name that points inside a private network'],
    ['https://mixed.example.net/x', 'a name with any private address'],
    ['https://meta.example.net/latest', 'the cloud metadata address'],
    ['https://unknown.example.org/x', 'a name that doesn’t resolve'],
    ['https://127.0.0.1/', 'a loopback address'],
    ['https://10.1.2.3/', 'a private address'],
    ['https://[::1]/', 'IPv6 loopback'],
    ['http://cdn.joescafe.com.au/app.js', 'plain HTTP'],
    ['https://cdn.joescafe.com.au:8443/app.js', 'another port'],
    ['https://user:pass@cdn.joescafe.com.au/app.js', 'credentials in the address'],
    ['file:///etc/passwd', 'a local file'],
    ['ftp://cdn.joescafe.com.au/x', 'another protocol'],
  ]) assert.equal(await ask(url), false, why)
  assert.equal(await ask('https://1.1.1.1/x'), true, 'a public address written as a number')
  for (const type of ['image', 'media', 'font', 'websocket']) assert.equal(await ask('https://cdn.joescafe.com.au/x', type), false, type)
  assert.equal(await ask('https://elsewhere.example.net/', 'document', { navigation: true, mainFrame: true }), false, 'the page can’t leave the business’s website')
  assert.equal(await ask(`${ORIGIN}/embed`, 'document', { navigation: true, mainFrame: false }), false, 'no frames')
  assert.equal(await ask('data:text/html,hi', 'document', { navigation: true, mainFrame: true }), false)
  assert.equal(await ask('data:image/png;base64,AAAA', 'script'), true, 'inline data never reaches the network')
})

test('the serverless browser keeps its web security switched on', () => {
  const flags = safeFlags(chromium.args)
  for (const flag of ['--disable-web-security', '--allow-running-insecure-content', '--disable-site-isolation-trials']) {
    assert.ok(chromium.args.includes(flag), `the package still sets ${flag} (re-check this list if it stops)`)
    assert.ok(!flags.includes(flag), `${flag} is removed`)
  }
  assert.ok(flags.includes('--no-sandbox') && flags.includes('--single-process'), 'what Lambda needs to start Chromium stays')
})

// A website built in JavaScript: every address answers with the same shell,
// and only a browser sees each page's words.
const SHELL = `<html><head><title>Joe’s Cafe</title></head><body><div id="root"></div><noscript><h1>Joe’s Cafe</h1><p>Great coffee and breakfast in the heart of Braddon since 2012. We are a small family cafe with a big heart and an even bigger coffee machine. Come in for a flat white, stay for the banana bread, and say hello to Joe, who has run the place since the first day it opened its doors.</p><p><a href="/menu">Menu</a> <a href="/contact">Contact</a></p></noscript></body></html>`
const RENDERED = {
  [`${ORIGIN}/`]: `<html><body><h1>Joe’s Cafe, Braddon</h1><p>We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays. Great coffee and breakfast in the heart of Braddon since 2012, with a seasonal menu and friendly staff who know your order.</p><a href="/menu">Menu</a><a href="/contact">Contact</a></body></html>`,
  [`${ORIGIN}/menu`]: `<html><body><h2>Breakfast</h2><p>Eggs Benedict $21. Smashed avocado $19. Gluten-free bread is available for $2 extra. Kids' pancakes $12. Every coffee is made with locally roasted beans from Canberra, and oat or almond milk is 80 cents extra.</p></body></html>`,
  [`${ORIGIN}/contact`]: `<html><body><p>Find us at 12 Lonsdale Street, Braddon ACT 2612. Call us on 02 6111 2222 or email hello@joescafe.com.au. Free street parking out front, and the bus stop is right outside. We are wheelchair accessible.</p></body></html>`,
}
function rig({ plain = () => SHELL, rendered = url => RENDERED[url], fail = null } = {}) {
  const renders = []
  return {
    renders,
    fetchPage: async url => { if (fail?.(url)) throw fail(url); return { html: plain(url), url } },
    renderPage: async (url, options) => {
      renders.push({ url, ...options })
      const html = rendered(url)
      if (html instanceof Error) throw html
      return { html, url }
    },
  }
}

test('a website built in JavaScript is read through the browser, page by page', async () => {
  const { renders, fetchPage, renderPage } = rig()
  const { pages } = await crawlWebsite({ origin: ORIGIN, fetchPage, renderPage })
  assert.deepEqual(pages.map(page => page.url), [`${ORIGIN}/`, `${ORIGIN}/contact`, `${ORIGIN}/menu`])
  assert.match(pages[0].text, /Monday to Friday 7am to 3pm/, 'the page’s own words, not the site-wide <noscript> text')
  assert.match(pages[1].text, /02 6111 2222/)
  assert.ok(renders.every(render => render.origin === ORIGIN && render.deadline > Date.now()), 'each render knows the website and its deadline')
})

test('a website that sends its words never opens the browser', async () => {
  const { renders, fetchPage, renderPage } = rig({ plain: url => RENDERED[url] || RENDERED[`${ORIGIN}/`] })
  const { pages } = await crawlWebsite({ origin: ORIGIN, fetchPage, renderPage })
  assert.equal(renders.length, 0)
  assert.equal(pages.length, 3)
})

test('the browser is used a fixed number of times, and a failed or empty render keeps the plain reading', async () => {
  const capped = rig()
  await crawlWebsite({ origin: ORIGIN, fetchPage: capped.fetchPage, renderPage: capped.renderPage, limits: { ...SCAN_LIMITS, renderPages: 1 } })
  assert.equal(capped.renders.length, 1)

  const broken = rig({ rendered: () => new Error('Chromium crashed') })
  const { pages } = await crawlWebsite({ origin: ORIGIN, fetchPage: broken.fetchPage, renderPage: broken.renderPage })
  assert.equal(pages.length, 1, 'the <noscript> words, once')
  assert.match(pages[0].text, /small family cafe/)

  const empty = rig({ rendered: () => '<html><body><div id="root">Loading…</div></body></html>' })
  const kept = await crawlWebsite({ origin: ORIGIN, fetchPage: empty.fetchPage, renderPage: empty.renderPage })
  assert.match(kept.pages[0].text, /small family cafe/, 'a page still loading isn’t better than the fallback')
})

test('a website that turns plain readers away gets the browser; a missing page doesn’t', async () => {
  const blocked = rig({ fail: () => Object.assign(new Error('blocked'), { code: 'WEBSITE_ACCESS_BLOCKED' }) })
  const { pages } = await crawlWebsite({ origin: ORIGIN, fetchPage: blocked.fetchPage, renderPage: blocked.renderPage })
  assert.match(pages[0].text, /7am to 3pm/)
  const missing = rig({ fail: () => Object.assign(new Error('gone'), { code: 'WEBSITE_REMOVED' }) })
  await assert.rejects(crawlWebsite({ origin: ORIGIN, fetchPage: missing.fetchPage, renderPage: missing.renderPage }), error => error.code === 'WEBSITE_REMOVED')
  assert.equal(missing.renders.length, 0)
})

test('the scan job closes the browser whether the scan works or not', async () => {
  for (const html of [Object.values(RENDERED)[0], null]) {
    const pg = await database()
    const person = await user(pg)
    const db = rpcClient(pg)
    await db.rpc('create_business', { p_user: person.id, p_email: person.email, p_website: ORIGIN, p_name: 'Joe’s Cafe' })
    const scan = (await db.rpc('start_scan', { p_user: person.id, p_website: ORIGIN })).data
    let closed = 0
    const renderer = { render: async url => ({ html: RENDERED[url], url }), close: async () => { closed++ } }
    const fetchPage = async url => { if (!html) throw Object.assign(new Error('gone'), { code: 'WEBSITE_REMOVED' }); return { html: SHELL, url } }
    const result = await runScan({ db, scanId: scan.id, configuration: { ai: false }, fetchPage, renderer })
    assert.equal(closed, 1, html ? 'after a scan that worked' : 'after a scan that failed')
    assert.equal(Boolean(result.failed), !html)
  }
})

test('the background scan brings the browser, and Netlify ships it as packages', async () => {
  const job = await readFile(new URL('../netlify/functions/scan-background.mts', import.meta.url), 'utf8')
  assert.match(job, /renderer: createRenderer\(\)/)
  const toml = await readFile(new URL('../netlify.toml', import.meta.url), 'utf8')
  assert.match(toml, /external_node_modules = \["puppeteer-core", "@sparticuz\/chromium-min"\]/)
  const renderer = createRenderer({ launch: async () => { throw new Error('never opened') } })
  await renderer.close()
})

test('the renderer launches behind its scan proxy and closes both resources', async () => {
  const events = []
  const page = { setDefaultTimeout() {}, async setUserAgent() {}, async setRequestInterception() {}, on() {},
    async goto() { return {} }, async waitForNetworkIdle() {}, url() { return `${ORIGIN}/` },
    async content() { return '<html><body>JavaScript-rendered business details</body></html>' } }
  const renderer = createRenderer({
    proxyFactory: async () => ({ url: 'http://127.0.0.1:12345', close: async () => { events.push('proxy closed') } }),
    launch: async (_read, proxyUrl) => {
      assert.equal(proxyUrl, 'http://127.0.0.1:12345')
      return { createBrowserContext: async () => ({ newPage: async () => page, close: async () => { events.push('context closed') } }),
        close: async () => { events.push('browser closed') } }
    },
  })
  const result = await renderer.render(`${ORIGIN}/`, { origin: ORIGIN, deadline: Date.now() + 1000 })
  assert.match(result.html, /JavaScript-rendered/)
  await renderer.close()
  assert.deepEqual(events, ['context closed', 'proxy closed', 'browser closed'])
})

test('a failed browser launch still shuts down the scan proxy', async () => {
  let closed = 0
  const renderer = createRenderer({
    proxyFactory: async () => ({ url: 'http://127.0.0.1:12345', close: async () => { closed++ } }),
    launch: async () => { throw new Error('local simulated startup failure') },
  })
  await assert.rejects(renderer.render(`${ORIGIN}/`, { origin: ORIGIN, deadline: Date.now() + 1000 }), /startup failure/)
  await renderer.close()
  assert.equal(closed, 1)
})
