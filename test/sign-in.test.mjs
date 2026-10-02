import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { database, rpcClient } from './helpers/database.mjs'
import { sendSignInCode, signInEmail } from '../netlify/functions/_lib/sign-in.mjs'
import { HttpError } from '../netlify/functions/_lib/runtime.mjs'

const configuration = { configured: true, key: 're_test', from: 'SayGday <hello@saygday.ai>', publicUrl: 'https://saygday.ai' }
const refused = (promise, status, code) => assert.rejects(promise, error => error instanceof HttpError && error.status === status && (!code || error.code === code))

async function rig({ link = email => ({ data: { properties: { email_otp: '482913', hashed_token: 'abc123' }, user: { email } }, error: null }), resend = { ok: true, status: 200 } } = {}) {
  const pg = await database()
  const db = rpcClient(pg)
  const asked = [], sent = []
  db.auth.admin = { generateLink: async params => { asked.push(params); return link(params.email) } }
  const fetchImpl = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return { ok: resend.ok, status: resend.status, json: async () => ({ name: 'validation_error' }) } }
  const send = (body, ip = '203.0.113.9', options = {}) => sendSignInCode({ db, body, ip, configuration, fetchImpl, ...options })
  return { pg, db, asked, sent, send }
}

test('the sign-in email carries the code, comes from SayGday and links nowhere', () => {
  const { subject, text, html } = signInEmail({ code: '482913' })
  assert.equal(subject, '482913 is your SayGday sign-in code')
  assert.match(text, /482913/)
  assert.match(html, />482913</)
  assert.doesNotMatch(html + text, /\{\{|supabase|localhost|href=/i, 'no template tags, no Supabase, no link to follow')
})

test('a code is made by Supabase and emailed by SayGday to the address typed', async () => {
  const { asked, sent, send } = await rig()
  assert.deepEqual(await send({ email: '  Jo@JoesCafe.com.au ' }), { sent: true })
  assert.deepEqual(asked, [{ type: 'magiclink', email: 'jo@joescafe.com.au' }], 'Supabase makes the code (and the account, the first time)')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].url, 'https://api.resend.com/emails')
  assert.equal(sent[0].init.headers.Authorization, 'Bearer re_test')
  assert.equal(sent[0].init.headers['Idempotency-Key'], 'sign-in-abc123')
  assert.deepEqual(sent[0].body.to, ['jo@joescafe.com.au'])
  assert.equal(sent[0].body.from, 'SayGday <hello@saygday.ai>')
  assert.equal(sent[0].body.subject, '482913 is your SayGday sign-in code')
  assert.match(sent[0].body.html, /482913/)
})

test('nothing is made or sent for a bad address, or before email is set up', async () => {
  const { asked, sent, send } = await rig()
  for (const email of ['', 'jo', 'jo@cafe', 'two words@cafe.com.au', 42, 'x'.repeat(250) + '@a.au']) await refused(send({ email }), 400, 'INVALID_EMAIL')
  await refused(send({ email: 'jo@joescafe.com.au' }, 'ip', { configuration: { configured: false } }), 503, 'NOT_CONFIGURED')
  assert.equal(asked.length, 0); assert.equal(sent.length, 0)
})

test('one code a minute for an address, six an hour, twenty an hour from one connection', async () => {
  const { pg, asked, send } = await rig()
  await send({ email: 'jo@joescafe.com.au' })
  await refused(send({ email: 'jo@joescafe.com.au' }), 429, 'RATE_LIMITED')
  assert.equal(asked.length, 1, 'a quick second ask makes no second code')
  const aMinuteLater = () => pg.query(`update public.rate_limits set window_started_at = window_started_at - interval '1 minute' where key like 'sign-in:email-minute:%'`)
  for (let index = 0; index < 5; index++) { await aMinuteLater(); await send({ email: 'jo@joescafe.com.au' }, `192.0.2.${index}`) }
  await aMinuteLater()
  await refused(send({ email: 'jo@joescafe.com.au' }, '192.0.2.99'), 429, 'RATE_LIMITED')
  assert.equal(asked.length, 6, 'six codes an hour for one address')
  for (let index = 0; index < 18; index++) await send({ email: `person${index}@example.com` })
  await refused(send({ email: 'one.more@example.com' }), 429, 'RATE_LIMITED')
  await send({ email: 'one.more@example.com' }, '198.51.100.7')
})

test('a refusal from Supabase or Resend says “try again”, never what went wrong inside', async () => {
  const supabaseDown = await rig({ link: () => ({ data: null, error: { status: 500, code: 'unexpected_failure', message: 'Database error saving new user' } }) })
  await assert.rejects(supabaseDown.send({ email: 'jo@joescafe.com.au' }), error => error.status === 503 && error.code === 'SIGN_IN_UNAVAILABLE' && !/Database/.test(error.message))
  assert.equal(supabaseDown.sent.length, 0)
  const noCode = await rig({ link: () => ({ data: { properties: {} }, error: null }) })
  await refused(noCode.send({ email: 'jo@joescafe.com.au' }), 503, 'SIGN_IN_UNAVAILABLE')
  assert.equal(noCode.sent.length, 0)
  const tooSoon = await rig({ link: () => ({ data: null, error: { status: 429, code: 'over_email_send_rate_limit' } }) })
  await refused(tooSoon.send({ email: 'jo@joescafe.com.au' }), 429, 'RATE_LIMITED')
  const resendRefuses = await rig({ resend: { ok: false, status: 403 } })
  await assert.rejects(resendRefuses.send({ email: 'jo@joescafe.com.au' }), error => error.status === 503 && error.code === 'EMAIL_UNAVAILABLE' && /try again/.test(error.message))
})

test('the sign-in page asks SayGday for the code, never Supabase’s own email', async () => {
  const login = await readFile(new URL('../src/site/SignIn.jsx', import.meta.url), 'utf8')
  assert.match(login, /fetch\('\/api\/sign-in'/)
  assert.doesNotMatch(login, /signInWithOtp|signInWithPassword|signUp\(/, 'Supabase’s built-in emails come from "Supabase Auth" and carry no code')
  assert.match(login, /verifyOtp\(\{ email: sentTo, token: code, type: 'email' \}\)/, 'Supabase still checks the code')
  const entry = await readFile(new URL('../netlify/functions/sign-in.mts', import.meta.url), 'utf8')
  assert.match(entry, /path: '\/api\/sign-in'/)
})
