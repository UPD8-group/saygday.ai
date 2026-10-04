import assert from 'node:assert/strict'
import test from 'node:test'
import { database, rpcClient, user } from './helpers/database.mjs'
import { ownerAction, websiteFrom, OWNER_ACTIONS } from '../netlify/functions/_lib/owner.mjs'
import { visitorAction, widgetFor } from '../netlify/functions/_lib/visitor.mjs'
import { enquiryEmail, sendEnquiryEmail } from '../netlify/functions/_lib/email.mjs'
import { HttpError, rpcResult } from '../netlify/functions/_lib/runtime.mjs'

const signedIn = (token = 'token') => new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
async function owner() {
  const pg = await database()
  const person = await user(pg, 'jo@joescafe.com.au')
  const db = rpcClient(pg, { user: person })
  const scans = []
  const act = (body, request = signedIn()) => ownerAction({ request, db, body, origin: 'https://saygday.ai',
    dependencies: { startScan: async ({ website }) => { scans.push(website); return { id: 'scan', status: 'queued', website } } } })
  return { pg, db, person, act, scans }
}
const refused = (promise, status, code) => assert.rejects(promise, error => error instanceof HttpError && error.status === status && (!code || error.code === code))

test('a web address is taken however the owner types it, and the scan starts at the home page', () => {
  assert.equal(websiteFrom('joescafe.com.au'), 'https://joescafe.com.au')
  assert.equal(websiteFrom(' https://WWW.JoesCafe.com.au/menu?x=1 '), 'https://www.joescafe.com.au')
  assert.equal(websiteFrom('http://joescafe.com.au/'), 'https://joescafe.com.au')
  for (const bad of ['', 'joes', 'ftp://joes.com.au', 'https://user:pass@joes.com.au', 'https://joes.com.au:8080', 'not a website at all', 42])
    assert.throws(() => websiteFrom(bad), error => error.code === 'INVALID_WEBSITE' || error.code === 'INVALID', String(bad))
})

test('the owner’s journey: website in, scan started, answers managed, look chosen', async () => {
  const { act, scans } = await owner()
  assert.deepEqual(await act({ action: 'me' }), { email: 'jo@joescafe.com.au', business: null, scan: null })
  const created = await act({ action: 'createBusiness', website: 'www.joescafe.com.au' })
  assert.equal(created.business.website, 'https://www.joescafe.com.au')
  assert.equal(created.business.notifyEmail, 'jo@joescafe.com.au', 'questions go to the sign-in email unless changed')
  assert.deepEqual(scans, ['https://www.joescafe.com.au'], 'the scan starts straight away')
  const again = await act({ action: 'createBusiness', website: 'elsewhere.com.au' })
  assert.equal(again.business.id, created.business.id, 'one business per account, whatever the second request says')
  assert.deepEqual(scans, ['https://www.joescafe.com.au'], 'and a second tap never starts a second scan')

  const faq = (await act({ action: 'saveFaq', question: 'Do you have parking?', answer: 'Free street parking out front.', variants: ['where can i park'] })).faq
  assert.equal(faq.status, 'approved')
  await refused(act({ action: 'saveFaq', question: 'do you have parking?', answer: 'Again' }), 409, 'DUPLICATE')
  await refused(act({ action: 'saveFaq', question: 'Hi', answer: '' }), 400)
  const draft = (await act({ action: 'saveFaq', question: 'Do you do takeaway?', answer: 'Yes.', status: 'draft' })).faq
  assert.equal((await act({ action: 'approveAll' })).approved, 1)
  const faqs = (await act({ action: 'listFaqs' })).faqs
  assert.ok(faqs.every(item => item.status === 'approved'))
  assert.equal(faqs.filter(item => item.featured).length, 2, 'the first answers become the opening buttons')
  assert.equal((await act({ action: 'deleteFaq', id: draft.id })).deleted, true)

  const updated = (await act({ action: 'updateBusiness', name: 'Joe’s Cafe', character: 'skippy', greeting: 'G’day! What can we help with?', notifyEmail: 'Team@JoesCafe.com.au' })).business
  assert.equal(updated.name, 'Joe’s Cafe'); assert.equal(updated.character, 'skippy'); assert.equal(updated.notifyEmail, 'team@joescafe.com.au')
  await refused(act({ action: 'updateBusiness', character: 'dropbear' }), 400)
  await refused(act({ action: 'updateBusiness', notifyEmail: 'nope' }), 400)
  await refused(act({ action: 'deleteFaq', id: 'not-an-id' }), 400)
  await refused(act({ action: 'dropTables' }), 400, 'UNKNOWN_ACTION')
  assert.ok(OWNER_ACTIONS.includes('startScan'))
  const rescan = await act({ action: 'startScan', website: 'joescafe.com.au' })
  assert.equal(rescan.scan.website, 'https://joescafe.com.au')
})

test('no sign-in, an unconfirmed email or a stranger’s token gets nothing', async () => {
  const pg = await database()
  const person = await user(pg)
  await refused(ownerAction({ request: new Request('https://saygday.ai/api/app', { method: 'POST' }), db: rpcClient(pg, { user: person }), body: { action: 'me' }, origin: 'https://saygday.ai' }), 401, 'AUTH_REQUIRED')
  await refused(ownerAction({ request: signedIn(), db: rpcClient(pg, { user: { ...person, email_confirmed_at: null } }), body: { action: 'me' }, origin: 'https://saygday.ai' }), 401, 'SESSION_EXPIRED')
  await refused(ownerAction({ request: signedIn(), db: rpcClient(pg), body: { action: 'me' }, origin: 'https://saygday.ai' }), 401, 'SESSION_EXPIRED')
  await refused(ownerAction({ request: signedIn(), db: rpcClient(pg, { user: person }), body: { action: 'listFaqs' }, origin: 'https://saygday.ai' }), 409, 'NO_BUSINESS')
})

test('database refusals reach the owner in plain words, never as database errors', () => {
  assert.throws(() => rpcResult({ data: null, error: { code: 'P0001', message: 'FEATURED_LIMIT' } }), /Up to six questions/)
  assert.throws(() => rpcResult({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "faqs_business_question_idx"' } }), error => error.code === 'DUPLICATE' && !/constraint/.test(error.message))
  assert.throws(() => rpcResult({ data: null, error: { code: 'XX000', message: 'internal detail' } }), error => error.status === 503 && !/internal detail/.test(error.message))
})

test('the chat gets approved answers only; a question it couldn’t answer reaches the business', async () => {
  const { pg, act } = await owner()
  const { business } = await act({ action: 'createBusiness', website: 'joescafe.com.au', name: 'Joe’s Cafe' })
  await act({ action: 'saveFaq', question: 'When are you open?', answer: '7am to 3pm.' })
  await act({ action: 'saveFaq', question: 'Secret draft?', answer: 'Not checked yet.', status: 'draft' })
  const db = rpcClient(pg)
  await db.rpc('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  const widget = await widgetFor({ db, slug: business.slug, seen: true, origin: 'https://joescafe.com.au' })
  assert.deepEqual(widget.faqs.map(faq => faq.question), ['When are you open?'])
  assert.ok((await act({ action: 'me' })).business.buttonSeenAt, 'the button being seen on the website is recorded')
  await assert.rejects(widgetFor({ db, slug: '../etc' }), error => error.status === 404)
  await assert.rejects(widgetFor({ db, slug: 'nobody-here' }), error => error.status === 404)

  const sent = []
  const ask = (body, ip = '203.0.113.9') => visitorAction({ db, body: { business: business.slug, site: 'https://joescafe.com.au', ...body }, ip, dependencies: { sendEnquiryEmail: async ({ enquiry }) => { sent.push(enquiry); return true } } })
  assert.deepEqual(await ask({ action: 'ask', question: 'Can I book the back room for a party?', email: 'Visitor@Example.com' }), { ok: true, sent: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].notifyEmail, 'jo@joescafe.com.au'); assert.equal(sent[0].email, 'visitor@example.com')
  assert.deepEqual(await ask({ action: 'ask', question: 'Do you sell gift cards?' }), { ok: true, sent: false })
  assert.equal(sent.length, 1, 'no email is sent when the visitor left none')
  assert.deepEqual(await ask({ action: 'ask', question: 'Buy cheap pills', website: 'http://spam.example' }), { ok: true }, 'a bot filling the hidden field is ignored quietly')
  await assert.rejects(ask({ action: 'ask', question: 'Hello?', email: 'not-an-email' }), error => error.code === 'INVALID_EMAIL')
  await assert.rejects(ask({ action: 'ask', question: 'x' }), error => error.code === 'INVALID_QUESTION')
  const inbox = (await act({ action: 'listEnquiries' })).enquiries
  assert.deepEqual(inbox.map(item => item.question), ['Do you sell gift cards?', 'Can I book the back room for a party?'])
  assert.equal(inbox[1].emailed, true)
  for (let index = 0; index < 8; index++) await ask({ action: 'ask', question: `Question ${index}?` }, '198.51.100.1')
  await assert.rejects(ask({ action: 'ask', question: 'One too many?' }, '198.51.100.1'), error => error.status === 429)

  const [answer] = widget.faqs
  assert.deepEqual(await visitorAction({ db, body: { business: business.slug, site: 'https://www.joescafe.com.au', action: 'viewed', faqId: answer.id }, ip: '1.1.1.1' }), { ok: true })
  assert.equal((await act({ action: 'listFaqs' })).faqs.find(faq => faq.id === answer.id).views, 1)
  await assert.rejects(visitorAction({ db, body: { business: business.slug, site: 'https://joescafe.com.au', action: 'delete' }, ip: '1.1.1.1' }), error => error.code === 'UNKNOWN_ACTION')
})

test('the enquiry email lets the owner reply straight to the visitor, and never runs unconfigured', async () => {
  const mail = enquiryEmail({ businessName: 'Joe’s <Cafe>', question: 'Can I bring <b>my dog</b>?', visitorEmail: 'visitor@example.com', publicUrl: 'https://saygday.ai' })
  assert.match(mail.subject, /Joe’s <Cafe>/)
  assert.ok(!mail.html.includes('<b>my dog</b>'), 'the visitor’s words are escaped')
  assert.match(mail.text, /Reply to this email/)
  const calls = []
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return new Response('{}', { status: 200 }) }
  const enquiry = { id: 'e1', businessName: 'Joe’s Cafe', notifyEmail: 'jo@joescafe.com.au', question: 'Dogs?', email: 'visitor@example.com' }
  assert.equal(await sendEnquiryEmail({ enquiry, configuration: { configured: false }, fetchImpl }), false)
  assert.equal(calls.length, 0)
  assert.equal(await sendEnquiryEmail({ enquiry, configuration: { configured: true, key: 'k', from: 'SayGday <hello@saygday.ai>', publicUrl: 'https://saygday.ai' }, fetchImpl }), true)
  assert.deepEqual(calls[0].body.to, ['jo@joescafe.com.au'])
  assert.equal(calls[0].body.reply_to, 'visitor@example.com')
  assert.equal(calls[0].headers['Idempotency-Key'], 'enquiry-e1')
  assert.equal(await sendEnquiryEmail({ enquiry, configuration: { configured: true, key: 'k', from: 'x', publicUrl: 'https://saygday.ai' }, fetchImpl: async () => { throw new Error('down') } }), false)
})
