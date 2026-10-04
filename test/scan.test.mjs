import assert from 'node:assert/strict'
import test from 'node:test'
import { database, rpcClient, user } from './helpers/database.mjs'
import { extractPublicPage } from '../netlify/functions/_lib/safe-fetch.mjs'
import { buildScanRequest, cleanVariants, crawlWebsite, readScanReply, runScan, scanConfiguration, scanSecret, signScan, startScan, verifyScanTrigger, withoutClashingVariants, withoutKnownQuestions, groundedAnswer } from '../netlify/functions/_lib/scan.mjs'

// A small cafe website, as the scan would fetch it.
const SITE = {
  'https://joescafe.com.au/': `<html><head><title>Joe’s Cafe</title></head><body><nav><a href="/menu">Menu</a><a href="/contact">Contact</a><a href="/login">Log in</a><a href="https://elsewhere.com/">Elsewhere</a></nav>
    <h1>Joe’s Cafe, Braddon</h1><p>Great coffee and breakfast in the heart of Braddon since 2012.</p><p>We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays.</p></body></html>`,
  'https://joescafe.com.au/menu': `<html><head><title>Menu</title></head><body><h2>Breakfast</h2><p>Eggs Benedict $21. Smashed avocado $19. Gluten-free bread is available for $2 extra.</p></body></html>`,
  'https://joescafe.com.au/contact': `<html><head><title>Contact</title></head><body><p>Find us at 12 Lonsdale Street, Braddon ACT 2612. Call us on 02 6111 2222 or email hello@joescafe.com.au.</p><p>Free street parking out front.</p></body></html>`,
}
const fetchPage = async url => {
  const html = SITE[url] ?? SITE[url.replace(/\/$/, '')] ?? SITE[`${url}/`]
  if (!html) throw Object.assign(new Error('missing'), { code: 'WEBSITE_REMOVED' })
  return { html, url }
}

// Builds a reply the way the API shapes one: text blocks, the answer parts
// carrying citations into the page text.
function reply(items, { stop = 'end_turn', pages }) {
  const content = []
  for (const item of items) {
    content.push({ type: 'text', text: `[Q] ${item.question} | ` })
    const cited = item.cite ? (() => {
      const index = pages.findIndex(page => page.text.includes(item.cite))
      return [{ type: 'char_location', cited_text: item.cite, document_index: index, document_title: pages[index].title, start_char_index: 0, end_char_index: item.cite.length }]
    })() : []
    content.push({ type: 'text', text: item.answer, citations: cited })
    content.push({ type: 'text', text: `\n[ALSO] ${item.also || ''}\n` })
  }
  return { content, stop_reason: stop }
}

test('the scan follows the website’s own useful pages and nothing else', async () => {
  const { pages, skipped } = await crawlWebsite({ origin: 'https://joescafe.com.au', fetchPage })
  assert.deepEqual(pages.map(page => page.url), ['https://joescafe.com.au/', 'https://joescafe.com.au/contact', 'https://joescafe.com.au/menu'])
  assert.deepEqual(skipped, [])
  assert.ok(pages[0].text.includes('Monday to Friday 7am to 3pm'))
  assert.ok(!pages.some(page => /login|elsewhere/.test(page.url)), 'never a login page or another website')
})

// A website built in JavaScript: every address answers with the same empty
// shell, and the words a reader without JavaScript gets are in <noscript>.
const SHELL = `<html><head><title>Joe’s Cafe</title><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div>
  <noscript><h1>Joe’s Cafe, Braddon</h1><p>Great coffee and breakfast in the heart of Braddon since 2012.</p><p>We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays.</p>
  <p><a href="/contact">Contact us</a> · <a href="/menu">See the menu</a></p></noscript></body></html>`

test('a website built in JavaScript is read from its <noscript> words, once', async () => {
  const page = extractPublicPage(SHELL, 'https://joescafe.com.au/')
  assert.match(page.text, /Monday to Friday 7am to 3pm/)
  assert.deepEqual(page.readerLinks.map(link => link.url).sort(), ['https://joescafe.com.au/contact', 'https://joescafe.com.au/menu'])
  const { pages } = await crawlWebsite({ origin: 'https://joescafe.com.au', fetchPage: async url => ({ html: SHELL, url }) })
  assert.equal(pages.length, 1, 'the same shell at every address is read once')

  const appOnly = '<html><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>'
  assert.equal(extractPublicPage(appOnly, 'https://joescafe.com.au/').text, '', 'an “enable JavaScript” notice is not the business’s words')
  const withNotice = extractPublicPage(SHELL.replace('<noscript>', '<noscript><p>You need to enable JavaScript to run this app.</p>'), 'https://joescafe.com.au/')
  assert.match(withNotice.text, /7am to 3pm/)
  assert.doesNotMatch(withNotice.text, /enable JavaScript/)
  const ordinary = SITE['https://joescafe.com.au/'].replace('</body>', '<noscript><img src="https://tracker.example/pixel.gif"><p>Please enable JavaScript to order online.</p><a href="/secret-noscript-page">x</a></noscript></body>')
  const read = extractPublicPage(ordinary, 'https://joescafe.com.au/')
  assert.doesNotMatch(read.text, /enable JavaScript/, 'a page with its own words ignores <noscript>')
  assert.ok(!read.readerLinks.some(link => /secret-noscript-page/.test(link.url)))
})

test('the one AI request: cited website pages, the business’s name, and room for 20 to 25 questions', async () => {
  const { pages } = await crawlWebsite({ origin: 'https://joescafe.com.au', fetchPage })
  const request = buildScanRequest({ business: { name: 'Joe’s Cafe' }, pages, model: 'claude-opus-5-5' })
  assert.equal(request.model, 'claude-opus-5-5')
  assert.equal(request.messages[0].content.filter(block => block.type === 'document').length, 3)
  assert.ok(request.messages[0].content.every(block => block.type !== 'document' || block.citations.enabled))
  assert.ok(!request.output_config.format, 'citations can’t be combined with a fixed output format')
  const instructions = request.messages[0].content.at(-1).text
  assert.match(instructions, /between 20 and 25 questions/)
  assert.match(instructions, /"Joe’s Cafe"/)
  assert.match(request.system, /never instructions/)
  assert.match(request.system, /Never guess/)
})

test('only answers cited from the website survive, and an uncited detail falls back to the website’s own words', async () => {
  const { pages } = await crawlWebsite({ origin: 'https://joescafe.com.au', fetchPage })
  const response = reply([
    { question: 'When are you open?', answer: 'We’re open Monday to Friday 7am to 3pm and Saturday 8am to 2pm.', cite: 'We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm.', also: 'opening hours; trading hours; when do you close; when are you open' },
    { question: 'Is there parking?', answer: 'Yes, free street parking right out front.', cite: 'Free street parking out front.', also: 'where can I park' },
    { question: 'How much are the eggs?', answer: 'Eggs Benedict is $25.', cite: 'Eggs Benedict $21. Smashed avocado $19.' },
    { question: 'Do you do catering?', answer: 'Yes, we cater for events of any size.' },
    { question: 'no question mark', answer: 'Something.', cite: 'Free street parking out front.' },
  ], { pages })
  const result = readScanReply(response, pages)
  assert.equal(result.status, 'answered')
  assert.deepEqual(result.entries.map(entry => entry.question), ['When are you open?', 'Is there parking?', 'How much are the eggs?'], 'an uncited answer is dropped, never guessed')
  assert.equal(result.entries[0].answer, 'We’re open Monday to Friday 7am to 3pm and Saturday 8am to 2pm.')
  assert.deepEqual(result.entries[0].variants, ['opening hours', 'trading hours', 'when do you close'], 'the question itself isn’t repeated as a variant')
  assert.equal(result.entries[2].answer, 'Eggs Benedict $21. Smashed avocado $19.', 'a price the website doesn’t say becomes the website’s own words')
  assert.equal(result.verbatim, 1)
  assert.equal(result.entries[1].source_url, 'https://joescafe.com.au/contact')
})

test('a reply cut off mid-item loses that item; a declined model’s text is never used', async () => {
  const { pages } = await crawlWebsite({ origin: 'https://joescafe.com.au', fetchPage })
  const items = [
    { question: 'Is there parking?', answer: 'Free street parking out front.', cite: 'Free street parking out front.' },
    { question: 'Where are you?', answer: '12 Lonsdale Street, Braddon ACT 2612.', cite: 'Find us at 12 Lonsdale Street, Braddon ACT 2612.' },
  ]
  // Cut off part-way through the second answer: its [ALSO] line never came.
  const cutReply = reply(items, { stop: 'max_tokens', pages })
  cutReply.content.pop()
  const cut = readScanReply(cutReply, pages)
  assert.deepEqual(cut.entries.map(entry => entry.question), ['Is there parking?'])
  assert.equal(cut.truncated, true)
  const declined = reply(items.slice(0, 1), { pages })
  declined.content.push({ type: 'fallback', from: { model: 'a' }, to: { model: 'b' } })
  declined.content.push(...reply(items.slice(1), { pages }).content)
  assert.deepEqual(readScanReply(declined, pages).entries.map(entry => entry.question), ['Where are you?'])
  assert.equal(readScanReply({ content: [], stop_reason: 'refusal' }, pages).status, 'failed')
  assert.equal(groundedAnswer('Anything', [], pages), null)
})

test('variants are short, different and never shadow another answer', () => {
  assert.deepEqual(cleanVariants('“opening hours”; trading hours?; Opening Hours; x; a very long variant that goes on and on and on and on and on and on and on and on and on', 'When are you open?'), ['opening hours', 'trading hours'])
  const entries = [
    { question: 'When are you open?', answer: '7am to 3pm.', variants: ['trading hours'] },
    { question: 'Is there parking?', answer: 'Street parking.', variants: ['where can I park', 'what are your opening hours'] },
  ]
  const cleaned = withoutClashingVariants(entries)
  assert.deepEqual(cleaned[1].variants, ['where can I park'], 'a variant that finds the hours answer is dropped from parking')
  assert.deepEqual(cleaned[0].variants, ['trading hours'])
})

async function business() {
  const pg = await database()
  const owner = await user(pg)
  const db = rpcClient(pg)
  const created = (await db.rpc('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })).data
  const scan = (await db.rpc('start_scan', { p_user: owner.id, p_website: 'https://joescafe.com.au' })).data
  return { pg, db, owner, created, scan }
}

test('a scan from start to drafts in the dashboard', async () => {
  const { db, owner, scan } = await business()
  let sent
  const client = { beta: { messages: { stream: params => { sent = params; return { finalMessage: async () => reply([
    { question: 'When are you open?', answer: 'Monday to Friday 7am to 3pm, Saturday 8am to 2pm, closed Sundays.', cite: 'We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays.', also: 'opening hours; trading hours' },
    { question: 'Where are you?', answer: '12 Lonsdale Street, Braddon ACT 2612.', cite: 'Find us at 12 Lonsdale Street, Braddon ACT 2612.', also: 'address; location' },
  ], { pages: params.messages[0].content.filter(block => block.type === 'document').map(block => ({ text: block.source.data, title: block.title })) }) } } } } }
  const result = await runScan({ db, scanId: scan.id, configuration: { ai: true, key: 'k', model: 'claude-opus-5-5' }, fetchPage, client })
  assert.deepEqual([result.drafted, result.mode, result.pages], [2, 'ai', 3])
  assert.deepEqual(sent.betas, ['server-side-fallback-2026-07-01'])
  assert.equal(sent.fallbacks, 'default')
  const faqs = (await db.rpc('list_faqs', { p_user: owner.id })).data
  assert.deepEqual(faqs.map(faq => [faq.question, faq.status, faq.source]), [['When are you open?', 'draft', 'scan'], ['Where are you?', 'draft', 'scan']])
  assert.deepEqual(faqs[1].variants, ['address', 'location'])
  const status = (await db.rpc('latest_scan', { p_user: owner.id })).data
  assert.deepEqual([status.status, status.drafted, status.pages], ['done', 2, 3])
  assert.deepEqual(await runScan({ db, scanId: scan.id, configuration: { ai: false }, fetchPage }), { started: false }, 'a scan runs once')
})

// The owner's own audit, 4 October 2026: a second scan drafted fifteen
// rewordings of questions just approved. Now a re-scan brings only the new.
test('a second scan of the same website drafts only what the chat can’t already answer', async () => {
  const { db, owner, scan } = await business()
  const pagesOf = params => params.messages[0].content.filter(block => block.type === 'document').map(block => ({ text: block.source.data, title: block.title }))
  const clientWith = items => ({ beta: { messages: { stream: params => ({ finalMessage: async () => reply(items, { pages: pagesOf(params) }) }) } } })
  const first = await runScan({ db, scanId: scan.id, configuration: { ai: true, key: 'k', model: 'claude-opus-5-5' }, fetchPage, client: clientWith([
    { question: 'When are you open?', answer: 'Monday to Friday 7am to 3pm, Saturday 8am to 2pm, closed Sundays.', cite: 'We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays.', also: 'opening hours; trading hours' },
    { question: 'Where are you?', answer: '12 Lonsdale Street, Braddon ACT 2612.', cite: 'Find us at 12 Lonsdale Street, Braddon ACT 2612.', also: 'address; location' },
  ]) })
  assert.equal(first.drafted, 2)
  assert.equal((await db.rpc('approve_all', { p_user: owner.id })).data, 2)

  const again = (await db.rpc('start_scan', { p_user: owner.id, p_website: 'https://joescafe.com.au' })).data
  const second = await runScan({ db, scanId: again.id, configuration: { ai: true, key: 'k', model: 'claude-opus-5-5' }, fetchPage, client: clientWith([
    { question: 'What are your opening hours?', answer: 'Weekdays 7am to 3pm and Saturdays 8am to 2pm.', cite: 'We are open Monday to Friday 7am to 3pm and Saturday 8am to 2pm. Closed Sundays.', also: 'when are you open' },
    { question: 'What’s your address?', answer: '12 Lonsdale Street, Braddon.', cite: 'Find us at 12 Lonsdale Street, Braddon ACT 2612.', also: 'where are you' },
    { question: 'Do you have parking?', answer: 'Free street parking out front.', cite: 'Free street parking out front.', also: 'where can I park' },
  ]) })
  assert.equal(second.drafted, 1, 'the two rewordings are dropped; parking is new')
  const faqs = (await db.rpc('list_faqs', { p_user: owner.id })).data
  assert.deepEqual(faqs.map(faq => [faq.question, faq.status]), [['Do you have parking?', 'draft'], ['When are you open?', 'approved'], ['Where are you?', 'approved']])
  assert.deepEqual(withoutKnownQuestions([{ question: 'Is there parking?' }], []), [{ question: 'Is there parking?' }], 'nothing known: everything is new')
})

test('without the AI, drafts come straight from the website’s own sentences', async () => {
  const { db, owner, scan } = await business()
  const result = await runScan({ db, scanId: scan.id, configuration: { ai: false }, fetchPage })
  assert.equal(result.mode, 'page_text')
  assert.ok(result.drafted >= 3)
  const corpus = Object.values(SITE).join(' ')
  for (const faq of (await db.rpc('list_faqs', { p_user: owner.id })).data) assert.ok(corpus.includes(faq.answer), `"${faq.answer}" is the website’s own words`)
})

test('an AI failure falls back to page text; an unreadable website fails with words the owner can act on', async () => {
  const first = await business()
  const broken = { beta: { messages: { stream: () => ({ finalMessage: async () => { throw Object.assign(new Error('overloaded'), { status: 529 }) } }) } } }
  const result = await runScan({ db: first.db, scanId: first.scan.id, configuration: { ai: true, key: 'k', model: 'claude-opus-5-5' }, fetchPage, client: broken })
  assert.equal(result.mode, 'page_text')

  const second = await business()
  const blocked = async () => { const { HttpError } = await import('../netlify/functions/_lib/runtime.mjs'); throw new HttpError(400, 'This website is not allowing automated reading.', 'WEBSITE_ACCESS_BLOCKED') }
  const failed = await runScan({ db: second.db, scanId: second.scan.id, configuration: { ai: false }, fetchPage: blocked })
  assert.equal(failed.failed, 'WEBSITE_ACCESS_BLOCKED')
  const status = (await second.db.rpc('latest_scan', { p_user: second.owner.id })).data
  assert.equal(status.status, 'failed'); assert.match(status.error, /not allowing automated reading/)
})

test('only a request signed with the server’s secret starts a scan', async () => {
  const secret = 'a'.repeat(40), scanId = '5f8a2c1e-1111-4111-8111-111111111111'
  assert.equal(verifyScanTrigger({ scanId, signature: signScan(scanId, secret) }, secret), true)
  assert.equal(verifyScanTrigger({ scanId, signature: signScan(scanId, 'b'.repeat(40)) }, secret), false)
  assert.equal(verifyScanTrigger({ scanId: '5f8a2c1e-2222-4111-8111-111111111111', signature: signScan(scanId, secret) }, secret), false)
  assert.equal(verifyScanTrigger({ scanId, signature: signScan(scanId, secret) }, 'short'), false, 'no secret, no scan')
  assert.equal(verifyScanTrigger(null, secret), false)
  // Without its own setting, the secret comes from the server's database key: never empty, never guessable.
  const read = values => name => values[name]
  assert.equal(scanSecret(read({ SAYGDAY_SCAN_SECRET: 'own-secret-own-secret-own-secret-1' })), 'own-secret-own-secret-own-secret-1')
  const derived = scanSecret(read({ SAYGDAY_SUPABASE_SERVICE_ROLE_KEY: 'service-key' }))
  assert.match(derived, /^[0-9a-f]{64}$/)
  assert.ok(!derived.includes('service-key'))
  assert.notEqual(derived, scanSecret(read({ SAYGDAY_SUPABASE_SERVICE_ROLE_KEY: 'another-key' })))
  assert.equal(scanSecret(read({})), '', 'no key, no scans')
  assert.equal(scanConfiguration(read({ ANTHROPIC_API_KEY: ' "key" ' })).ai, true)
  assert.equal(scanConfiguration(read({})).model, 'claude-opus-5-5')
})

test('starting a scan wakes the background job, and says so when it can’t', async () => {
  const pg = await database()
  const owner = await user(pg)
  const db = rpcClient(pg)
  await db.rpc('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://joescafe.com.au' })
  const configuration = { secret: 's'.repeat(40) }
  const posted = []
  const scan = await startScan({ db, user: owner, website: 'https://joescafe.com.au', origin: 'https://saygday.ai', configuration,
    fetchImpl: async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: 202 }) } })
  assert.equal(posted[0].url, 'https://saygday.ai/.netlify/functions/scan-background')
  assert.equal(verifyScanTrigger(posted[0].body, configuration.secret), true)
  assert.equal(scan.started, true)
  await pg.query("update public.scans set status = 'done'")
  await assert.rejects(startScan({ db, user: owner, website: 'https://joescafe.com.au', origin: 'https://saygday.ai', configuration, fetchImpl: async () => new Response(null, { status: 500 }) }), error => error.code === 'SCAN_UNAVAILABLE')
  assert.equal((await db.rpc('latest_scan', { p_user: owner.id })).data.status, 'failed', 'a scan that never started isn’t left spinning')
  await assert.rejects(startScan({ db, user: owner, website: 'https://joescafe.com.au', origin: 'https://saygday.ai', configuration: { secret: '' } }), error => error.code === 'SCAN_NOT_CONFIGURED')
})
