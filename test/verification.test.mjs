import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { database, rpcClient, user } from './helpers/database.mjs'
import { checkWebsite, hasButton, sameSite, siteKey, txtRecord } from '../netlify/functions/_lib/verify-website.mjs'
import { visitorAction, widgetFor } from '../netlify/functions/_lib/visitor.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { HttpError } from '../netlify/functions/_lib/runtime.mjs'

// A business proves it owns its website before its chat goes live (owner,
// 3 October 2026): its own chat button on the home page, or a DNS TXT record.
// Until then the chat serves nothing; afterwards, only on that website.
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const BUTTON = slug => `<script src="https://saygday.ai/widget.js" data-business="${slug}" defer></script>`
const page = body => `<!doctype html><html><head><title>Joe’s Cafe</title></head><body><h1>Joe’s Cafe</h1>${body}</body></html>`

async function setup() {
  const pg = await database()
  const db = rpcClient(pg)
  const call = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    return data
  }
  const owner = await user(pg, 'jo@joescafe.com.au')
  const business = await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })
  await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'When are you open?', p_answer: '7am to 3pm.' })
  return { pg, db, call, owner, business }
}
const verify = (call, business, website = business.website) => call('mark_website_verified', { p_slug: business.slug, p_website: website, p_method: 'button' })

test('a new business is hidden: no answers, no questions taken, never "seen", until its website is verified', async () => {
  const { call, owner, business } = await setup()
  assert.match(business.verificationToken, /^[0-9a-f]{32}$/, 'its own DNS token')
  assert.equal(business.websiteVerifiedAt, null)
  assert.equal(await call('widget', { p_slug: business.slug }), null)
  assert.equal(await call('chat_website', { p_slug: business.slug }), null)
  assert.equal(await call('button_seen', { p_slug: business.slug }), false)
  await assert.rejects(call('ask_team', { p_slug: business.slug, p_question: 'Hello?' }), /NOT_FOUND/)
  const [faq] = await call('list_faqs', { p_user: owner.id })
  assert.equal(await call('faq_viewed', { p_slug: business.slug, p_faq: faq.id }), false)
  assert.deepEqual(await call('verification_target', { p_slug: business.slug }), { slug: business.slug, website: 'https://joescafe.com.au', verificationToken: business.verificationToken })

  assert.equal(await verify(call, business), true)
  const now = await call('my_business', { p_user: owner.id })
  assert.ok(now.websiteVerifiedAt); assert.equal(now.verifiedBy, 'button')
  assert.equal((await call('widget', { p_slug: business.slug })).faqs.length, 1, 'verified: the chat runs')
  assert.equal(await call('chat_website', { p_slug: business.slug }), 'https://joescafe.com.au')
  assert.equal(await call('verification_target', { p_slug: business.slug }), null, 'nothing left to check')
  assert.ok(await call('ask_team', { p_slug: business.slug, p_question: 'Hello?' }))
})

test('a different website starts again; www or not is the same website; one business per website', async () => {
  const { pg, call, owner, business } = await setup()
  await assert.rejects(verify(call, business, 'https://other.com.au'), /WEBSITE_CHANGED/, 'a check of an address that is no longer the business’s counts for nothing')
  await assert.rejects(call('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'trust-me' }), /INVALID_METHOD/)
  await verify(call, business)
  await call('start_scan', { p_user: owner.id, p_website: 'https://www.joescafe.com.au' })
  assert.ok((await call('my_business', { p_user: owner.id })).websiteVerifiedAt, 'adding www keeps it verified')
  await call('start_scan', { p_user: owner.id, p_website: 'https://joes-new-cafe.com.au' })
  assert.equal((await call('my_business', { p_user: owner.id })).websiteVerifiedAt, null, 'a new website is a new claim')
  assert.equal(await call('widget', { p_slug: business.slug }), null)

  const rival = await user(pg)
  const copy = await call('create_business', { p_user: rival.id, p_email: rival.email, p_website: 'https://joes-new-cafe.com.au' })
  await verify(call, copy)
  const mine = await call('my_business', { p_user: owner.id })
  await assert.rejects(verify(call, mine), /WEBSITE_TAKEN/, 'a website already proved by another business can’t be taken')
  assert.notEqual(copy.verificationToken, business.verificationToken)
})

test('the proof on the page is the business’s own chat button, as a real script tag', () => {
  for (const html of [
    page(BUTTON('joes-cafe')),
    page(`<script data-business='joes-cafe' src='https://www.saygday.ai/widget.js'></script>`),
    page('<script defer data-business=joes-cafe src=//saygday.ai/widget.js?v=2></script>'),
    page('<script src="https://saygdayai.netlify.app/widget.js" data-business=" joes-cafe "></script>'),
    `<html><head>${BUTTON('joes-cafe')}</head><body></body></html>`,
  ]) assert.equal(hasButton(html, 'joes-cafe'), true, html)
  for (const html of [
    page(BUTTON('someone-else')),
    page('<script src="https://evil.example/widget.js" data-business="joes-cafe"></script>'),
    page('<script src="https://saygday.ai.evil.example/widget.js" data-business="joes-cafe"></script>'),
    page('<p>&lt;script src="https://saygday.ai/widget.js" data-business="joes-cafe"&gt;&lt;/script&gt;</p>'),
    page('<p>&lt;script src=&quot;https://saygday.ai/widget.js&quot; data-business=&quot;joes-cafe&quot;&gt;&lt;/script&gt;</p>'),
    page('<div data-business="joes-cafe"><img src="https://saygday.ai/widget.js"></div>'),
    page('<script>var code = \'<script src="https://saygday.ai/widget.js" data-business="joes-cafe"></scr\' + \'ipt>\'</script>'),
    page('<textarea><script src="https://saygday.ai/widget.js" data-business="joes-cafe"></script></textarea>'),
    '', null,
  ]) assert.equal(hasButton(html, 'joes-cafe'), false, String(html))
})

test('the check reads the home page (www or not), and falls back to the DNS record', async () => {
  const token = 'a'.repeat(32)
  const site = (pages, txt = []) => ({
    safeHtml: async url => { const html = pages[url]; if (html instanceof Error) throw html; if (html === undefined) throw Object.assign(new Error('gone'), { code: 'WEBSITE_UNAVAILABLE' }); return { html, url } },
    resolveTxt: async host => { if (host !== 'joescafe.com.au') throw new Error('ENOTFOUND'); return txt },
  })
  const check = dependencies => checkWebsite({ website: 'https://joescafe.com.au', slug: 'joes-cafe', token, dependencies })
  assert.deepEqual(await check(site({ 'https://joescafe.com.au/': page(BUTTON('joes-cafe')) })), { method: 'button' })
  const moved = Object.assign(new Error('redirects'), { code: 'REDIRECT_ORIGIN_CHANGED' })
  assert.deepEqual(await check(site({ 'https://joescafe.com.au/': moved, 'https://www.joescafe.com.au/': page(BUTTON('joes-cafe')) })), { method: 'button' }, 'a home page that moves to www is still read')
  assert.deepEqual(await check(site({}, [['saygday-verification=', token]])), { method: 'dns' }, 'a long TXT record arrives in pieces')
  assert.deepEqual(await check(site({}, [[txtRecord('b'.repeat(32))], ['v=spf1 -all']])), { method: null, reason: 'unreachable' })
  assert.deepEqual(await check(site({ 'https://joescafe.com.au/': page('<p>No button here</p>') })), { method: null, reason: 'missing' })
  const blocked = Object.assign(new Error('403'), { code: 'WEBSITE_ACCESS_BLOCKED' })
  assert.deepEqual(await check(site({ 'https://joescafe.com.au/': blocked, 'https://www.joescafe.com.au/': blocked })), { method: null, reason: 'blocked' })
  assert.deepEqual(await checkWebsite({ website: 'https://joescafe.com.au', slug: 'joes-cafe', token: 'not-a-token', dependencies: site({}, [[txtRecord('not-a-token')]]) }), { method: null, reason: 'unreachable' }, 'only a real token counts')
  assert.equal(siteKey('https://WWW.JoesCafe.com.au/menu'), 'joescafe.com.au')
  assert.equal(sameSite('https://joescafe.com.au', 'http://www.joescafe.com.au'), true)
  assert.equal(sameSite('https://joescafe.com.au', 'https://joescafe.com.au.evil.example'), false)
  assert.equal(sameSite('https://joescafe.com.au', null), false)
  assert.equal(sameSite(null, 'https://joescafe.com.au'), false)
})

test('the first time the button loads on its own website, the server checks and switches the chat on', async () => {
  const { db, call, owner, business } = await setup()
  const checked = []
  const checkWith = method => ({ checkWebsite: async target => { checked.push(target); return method ? { method } : { method: null, reason: 'missing' } } })
  const load = (origin, dependencies) => widgetFor({ db, slug: business.slug, seen: true, origin, dependencies })
  await assert.rejects(load('https://evil.example', checkWith('button')), error => error.status === 404)
  assert.equal(checked.length, 0, 'a button on someone else’s website never starts a check')
  await assert.rejects(widgetFor({ db, slug: business.slug, seen: true, origin: null, dependencies: checkWith('button') }), error => error.status === 404)
  await assert.rejects(load('https://joescafe.com.au', checkWith(null)), error => error.status === 404)
  assert.deepEqual(checked.at(-1), { website: 'https://joescafe.com.au', slug: business.slug, token: business.verificationToken })
  const widget = await load('https://www.joescafe.com.au', checkWith('button'))
  assert.equal(widget.name, 'Joe’s Cafe'); assert.equal(widget.faqs.length, 1)
  assert.ok(!('website' in widget), 'the chat gets only what it shows')
  const now = await call('my_business', { p_user: owner.id })
  assert.equal(now.verifiedBy, 'button'); assert.ok(now.buttonSeenAt, 'and the button counts as seen')
})

test('the first-sight check runs at most twelve times an hour for a business', async () => {
  const { db, business } = await setup()
  let checks = 0
  const dependencies = { checkWebsite: async () => { checks += 1; return { method: null, reason: 'missing' } } }
  for (let index = 0; index < 14; index++) await widgetFor({ db, slug: business.slug, seen: true, origin: 'https://joescafe.com.au', dependencies }).catch(() => {})
  assert.equal(checks, 12)
})

test('once verified, the chat runs only on its own website', async () => {
  const { db, call, business } = await setup()
  await verify(call, business)
  const ok = { checkWebsite: async () => assert.fail('a verified business is never checked again') }
  assert.ok(await widgetFor({ db, slug: business.slug, seen: true, origin: 'https://joescafe.com.au', dependencies: ok }))
  assert.ok(await widgetFor({ db, slug: business.slug, site: 'https://www.joescafe.com.au' }), 'the chat window inside the website')
  for (const [origin, site] of [['https://evil.example', null], [null, 'https://evil.example'], [null, null], ['https://evil.example', 'https://joescafe.com.au']])
    await assert.rejects(widgetFor({ db, slug: business.slug, origin, site }), error => error instanceof HttpError && error.status === 404, `${origin} ${site}`)
  const ask = site => visitorAction({ db, body: { business: business.slug, site, action: 'ask', question: 'Do you cater?' }, ip: '203.0.113.5', dependencies: { sendEnquiryEmail: async () => true } })
  assert.deepEqual(await ask('https://joescafe.com.au'), { ok: true, sent: false, notification: 'not_requested' })
  await assert.rejects(ask('https://evil.example'), error => error.status === 404)
  await assert.rejects(ask(undefined), error => error.status === 404)
})

test('Check my website: the owner asks, the server looks, the dashboard hears why not', async () => {
  const pg = await database()
  const person = await user(pg, 'jo@joescafe.com.au')
  const db = rpcClient(pg, { user: person })
  let answer = { method: null, reason: 'missing' }, checks = 0
  const act = body => ownerAction({ request: new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: 'Bearer token' } }), db, body, origin: 'https://saygday.ai',
    dependencies: { startScan: async ({ website }) => ({ id: 'scan', status: 'queued', website }), checkWebsite: async () => { checks += 1; return answer } } })
  await assert.rejects(act({ action: 'verifyWebsite' }), error => error.status === 409)
  await act({ action: 'createBusiness', website: 'joescafe.com.au' })
  const notYet = await act({ action: 'verifyWebsite' })
  assert.equal(notYet.verified, false); assert.equal(notYet.reason, 'missing'); assert.equal(notYet.business.websiteVerifiedAt, null)
  answer = { method: 'dns' }
  const done = await act({ action: 'verifyWebsite' })
  assert.equal(done.verified, true); assert.equal(done.business.verifiedBy, 'dns')
  await act({ action: 'verifyWebsite' })
  assert.equal(checks, 2, 'a verified website isn’t checked again')

  const rival = await user(pg)
  const rivalDb = rpcClient(pg, { user: rival })
  const rivalAct = body => ownerAction({ request: new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: 'Bearer token' } }), db: rivalDb, body, origin: 'https://saygday.ai',
    dependencies: { startScan: async ({ website }) => ({ id: 'scan', status: 'queued', website }), checkWebsite: async () => ({ method: 'button' }) } })
  await rivalAct({ action: 'createBusiness', website: 'www.joescafe.com.au' })
  await assert.rejects(rivalAct({ action: 'verifyWebsite' }), error => error.status === 409 && error.code === 'WEBSITE_TAKEN' && /contact page/.test(error.message))
  const busy = rpcClient(pg, { user: await user(pg) })
  const busyAct = body => ownerAction({ request: new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: 'Bearer token' } }), db: busy, body, origin: 'https://saygday.ai',
    dependencies: { startScan: async ({ website }) => ({ id: 'scan', status: 'queued', website }), checkWebsite: async () => ({ method: null, reason: 'missing' }) } })
  await busyAct({ action: 'createBusiness', website: 'busy.com.au' })
  for (let index = 0; index < 30; index++) await busyAct({ action: 'verifyWebsite' })
  await assert.rejects(busyAct({ action: 'verifyWebsite' }), error => error.status === 429)
})

test('the button, the chat window, the dashboard and the privacy page all play their part', async () => {
  const widget = await read('public/widget.js')
  assert.match(widget, /frame\.setAttribute\('referrerpolicy', 'origin'\)/, 'the chat window always learns which website holds it')
  const chat = await read('src/chat/main.jsx')
  assert.match(chat, /if \(window\.parent === window\) return null/, 'opened on its own, the chat has no website')
  assert.match(chat, /location\.ancestorOrigins/)
  assert.match(chat, /if \(!site\) return <div className="chat chat--unavailable"><p[^>]*>This chat opens from the business’s own website\.<\/p><\/div>/)
  assert.match(chat, /&site=\$\{encodeURIComponent\(site\)\}/)
  assert.match(chat, /JSON\.stringify\(\{ business: slug, site, \.\.\.body \}\)/)
  const fn = await read('netlify/functions/chat.mts')
  assert.match(fn, /Vary: 'Origin', 'Netlify-Vary': 'header=Origin'/, 'a cached answer for one website is never served to another')
  assert.match(fn, /origin: origin && origin !== url\.origin \? origin : null, site: url\.searchParams\.get\('site'\)/)
  const button = await read('src/app/ChatButton.jsx')
  assert.match(button, /request\('verifyWebsite'\)/)
  assert.match(button, /saygday-verification=\$\{business\.verificationToken\}/)
  assert.match(button, /<SwitchOn business=\{business\} request=\{dash\.request\} onBusiness=\{dash\.setBusiness\} \/>/)
  const home = await read('src/app/Dashboard.jsx')
  assert.match(home, /: !verified \? \{ tone: 'gold', title: 'Put the chat button on your website'/, 'the home page never calls an unverified chat live')
  const privacy = (await read('site/privacy.html')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.ok(privacy.includes('Before your chat goes live, we check the website is yours'), 'the privacy page says how we check')
})
