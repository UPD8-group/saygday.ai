import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { database, rpcClient, user } from './helpers/database.mjs'
import { ADMIN_COOKIE, MIN_PASSWORD_LENGTH, SESSION_SECONDS, adminAction, adminConfiguration, listAccounts, sessionToken, validSession } from '../netlify/functions/_lib/admin.mjs'
import { HttpError, rateLimitKey } from '../netlify/functions/_lib/runtime.mjs'
import { CSV_COLUMNS, PRICE, TRIAL_DAYS, businessesCsv, csvCell, investorSummary, mondayOf, progressOf, stageOf, summarise, sydneyDay } from '../src/admin/metrics.mjs'

// SayGday's own admin page (owner, 5 October 2026: "I'm unable to see how many
// businesses have actually signed up… where they might be up to in the 14-day
// free trial… I will put the password required to access it in an [env var]
// on netlify"). One password from SAYGDAY_ADMIN_PASSWORD, a signed cookie only
// the admin API receives, and nothing a customer typed.
const PASSWORD = 'correct horse battery staple'
const settings = (password = PASSWORD) => adminConfiguration(name => ({ SAYGDAY_ADMIN_PASSWORD: password, SAYGDAY_SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[name])
const configuration = settings()
const DAY = 86400000
const request = (headers = {}) => new Request('https://saygday.ai/api/admin', { method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://saygday.ai', 'sec-fetch-site': 'same-origin', ...headers } })
const signedIn = (token = sessionToken(configuration)) => request({ cookie: `other=1; ${ADMIN_COOKIE}=${token}` })
const refused = (promise, status, code) => assert.rejects(promise, error => error instanceof HttpError && error.status === status && (!code || error.code === code))
const tokenFrom = cookie => /^saygday-admin=([^;]*);/.exec(cookie)?.[1]

// Supabase Auth's admin API, as the server sees it: every sign-in, and one by id.
function signIns(db, people) {
  db.auth.admin = {
    listUsers: async ({ page, perPage }) => ({ data: { users: people.slice((page - 1) * perPage, page * perPage), total: people.length }, error: null }),
    getUserById: async uid => ({ data: { user: people.find(person => person.id === uid) || null }, error: null }),
  }
}
const person = (account, extra = {}) => ({ id: account.id, email: account.email, created_at: new Date().toISOString(), last_sign_in_at: new Date().toISOString(), email_confirmed_at: new Date().toISOString(), ...extra })

async function platform() {
  const pg = await database()
  const db = rpcClient(pg)
  const call = async (name, args = {}) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    return data
  }
  const act = (body, req = signedIn(), ip = '203.0.113.5', options = {}) => adminAction({ request: req, db, body, ip, configuration, ...options })
  return { pg, db, call, act }
}

test('the admin page stays switched off without a long enough password, and opens only for the right one', async () => {
  const { db } = await platform()
  for (const action of ['session', 'signIn', 'overview']) {
    await refused(adminAction({ request: signedIn(), db, body: { action, password: '' }, ip: '1.1.1.1', configuration: settings('') }), 503, 'ADMIN_NOT_CONFIGURED')
    await refused(adminAction({ request: signedIn(), db, body: { action, password: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) }, ip: '1.1.1.1', configuration: settings('x'.repeat(MIN_PASSWORD_LENGTH - 1)) }), 503, 'ADMIN_PASSWORD_TOO_SHORT')
  }
  assert.equal(validSession(settings('short'), sessionToken(settings('short'))), false, 'a password that is too short opens nothing')
  const act = body => adminAction({ request: request(), db, body, ip: '203.0.113.9', configuration })
  assert.deepEqual(await act({ action: 'session' }), { result: { signedIn: false } })
  await refused(act({ action: 'overview' }), 401, 'ADMIN_SIGN_IN')
  await refused(act({ action: 'business', business: '00000000-0000-0000-0000-000000000000' }), 401, 'ADMIN_SIGN_IN')
  await refused(act({ action: 'setPlan', business: '00000000-0000-0000-0000-000000000000', plan: 'paying' }), 401, 'ADMIN_SIGN_IN')
  for (const password of ['', 'wrong password!', `${PASSWORD}x`, PASSWORD.toUpperCase(), 42, null])
    await refused(act({ action: 'signIn', password }), 401, 'WRONG_PASSWORD')
  await refused(act({ action: 'dropTables' }), 400, 'UNKNOWN_ACTION')
})

test('the right password opens a signed twelve-hour session that only the admin API is sent', async () => {
  const { db } = await platform()
  const now = Date.now()
  const { result, cookie } = await adminAction({ request: request(), db, body: { action: 'signIn', password: `  ${PASSWORD} ` }, ip: '203.0.113.9', configuration, now })
  assert.deepEqual(result, { signedIn: true })
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin', `Max-Age=${SESSION_SECONDS}`])
    assert.ok(cookie.split('; ').includes(part), `the cookie is ${part}`)
  assert.equal(SESSION_SECONDS, 12 * 60 * 60)
  const token = tokenFrom(cookie)
  assert.ok(!cookie.includes(PASSWORD) && !token.includes(Buffer.from(PASSWORD).toString('base64url')), 'the cookie never carries the password')
  assert.deepEqual((await adminAction({ request: signedIn(token), db, body: { action: 'session' }, ip: '203.0.113.9', configuration, now })).result, { signedIn: true })

  // Forged, stretched, expired or from before a password change: no entry.
  const [expires, signature] = token.split('.')
  const flipped = signature.slice(0, -1) + (signature.at(-1) === 'A' ? 'B' : 'A')
  for (const forged of [`${expires}.${flipped}`, `${Number(expires) + DAY}.${signature}`, `${expires}.${signature}x`, `${expires}`, '', 'null'])
    assert.equal(validSession(configuration, forged, now), false, forged)
  assert.equal(validSession(configuration, token, now + SESSION_SECONDS * 1000 + 1), false, 'twelve hours, then sign in again')
  assert.equal(validSession(settings('a brand new password'), token, now), false, 'changing the password signs everyone out')
  assert.equal(validSession(adminConfiguration(name => ({ SAYGDAY_ADMIN_PASSWORD: PASSWORD, SAYGDAY_SUPABASE_SERVICE_ROLE_KEY: 'another' })[name]), token, now), false,
    'the signature needs the server’s own key as well as the password')
  await refused(adminAction({ request: signedIn(`${expires}.${flipped}`), db, body: { action: 'overview' }, ip: '203.0.113.9', configuration, now }), 401, 'ADMIN_SIGN_IN')

  const out = await adminAction({ request: signedIn(token), db, body: { action: 'signOut' }, ip: '203.0.113.9', configuration, now })
  assert.match(out.cookie, /^saygday-admin=; Path=\/api\/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/, 'signing out clears the cookie')
})

test('another website’s page can’t use the admin API, even in a signed-in browser', async () => {
  const { db } = await platform()
  const token = sessionToken(configuration)
  const ask = headers => adminAction({ request: request({ cookie: `${ADMIN_COOKIE}=${token}`, ...headers }), db, body: { action: 'session' }, ip: '1.1.1.1', configuration })
  await refused(ask({ origin: 'https://evil.example' }), 403, 'CROSS_SITE')
  await refused(ask({ origin: 'https://saygday.ai.evil.example' }), 403, 'CROSS_SITE')
  await refused(ask({ origin: 'null' }), 403, 'CROSS_SITE')
  await refused(ask({ 'sec-fetch-site': 'cross-site' }), 403, 'CROSS_SITE')
  await refused(ask({ origin: 'https://www.saygday.ai', 'sec-fetch-site': 'same-site' }), 403, 'CROSS_SITE')
  assert.deepEqual((await ask({})).result, { signedIn: true }, 'the page itself')
  const plain = new Request('https://saygday.ai/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `${ADMIN_COOKIE}=${token}` } })
  assert.deepEqual((await adminAction({ request: plain, db, body: { action: 'session' }, ip: '1.1.1.1', configuration })).result, { signedIn: true },
    'a request no browser page made carries no cookie of the owner’s unless it has the password')
  const admin = await readFile(new URL('../netlify/functions/admin.mts', import.meta.url), 'utf8')
  assert.match(admin, /readJson\(request, 4096\)/, 'only JSON, which no plain form on another website can send')
})

test('password guesses are limited: ten an hour from one connection, fifty in all, counted without keeping the address', async () => {
  const { pg, db } = await platform()
  const guess = (ip, password = 'not the password') => adminAction({ request: request(), db, body: { action: 'signIn', password }, ip, configuration })
  for (let index = 0; index < 10; index++) await refused(guess('203.0.113.50'), 401, 'WRONG_PASSWORD')
  await refused(guess('203.0.113.50', PASSWORD), 429, 'RATE_LIMITED')
  // Ten so far count towards the fifty; forty more from forty connections.
  for (let index = 0; index < 40; index++) await refused(guess(`198.51.100.${index}`), 401, 'WRONG_PASSWORD')
  await refused(guess('192.0.2.200', PASSWORD), 429, 'RATE_LIMITED')
  const keys = (await pg.query('select key from public.rate_limits order by key')).rows.map(row => row.key)
  assert.deepEqual([...new Set(keys.map(key => key.slice(0, key.lastIndexOf(':'))))].sort(), ['admin-sign-in', 'admin-sign-in-all'])
  for (const key of keys) {
    assert.match(key, /^[a-z:-]+:[A-Za-z0-9_-]{32}$/)
    assert.ok(!key.includes('203.0.113') && !key.includes('198.51.100'), `${key} keeps no address`)
  }
  assert.ok(keys.includes(rateLimitKey('admin-sign-in', '203.0.113.50')))
})

test('the overview: every sign-in and business, where each is in its 14 days, and never a customer’s question or email', async () => {
  const { pg, db, call, act } = await platform()
  const jo = await user(pg, 'jo@joescafe.com.au'), sam = await user(pg, 'sam@bakery.com.au'), new1 = await user(pg, 'never@example.com'), us = await user(pg, 'james@saygday.ai')
  const cafe = await call('create_business', { p_user: jo.id, p_email: jo.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })
  const bakery = await call('create_business', { p_user: sam.id, p_email: sam.email, p_website: 'https://bakery.com.au', p_name: 'The Bakery' })
  const own = await call('create_business', { p_user: us.id, p_email: us.email, p_website: 'https://saygday.ai', p_name: 'SayGday' })
  await pg.query(`update public.businesses set created_at = now() - interval '20 days' where id = $1`, [bakery.id])
  await call('mark_website_verified', { p_slug: cafe.slug, p_website: cafe.website, p_method: 'button' })
  const faq = await call('save_faq', { p_user: jo.id, p_id: null, p_question: 'When are you open?', p_answer: '7am to 3pm.' })
  await call('save_faq', { p_user: jo.id, p_id: null, p_question: 'Do you cater?', p_answer: 'Not yet.', p_status: 'draft' })
  await call('faq_viewed', { p_slug: cafe.slug, p_faq: faq.id })
  await call('faq_viewed', { p_slug: cafe.slug, p_faq: faq.id })
  await call('button_seen', { p_slug: cafe.slug })
  await call('ask_team_queued', { p_slug: cafe.slug, p_question: 'Can I book the back room for my mum’s 80th?', p_email: 'visitor@example.net' })
  await call('ask_team_queued', { p_slug: cafe.slug, p_question: 'Is the kitchen nut free?' })
  await call('start_scan', { p_user: jo.id, p_website: cafe.website })
  await call('admin_set_plan', { p_business: own.id, p_plan: 'internal' })
  signIns(db, [person(jo), person(sam), person(new1, { email_confirmed_at: null, last_sign_in_at: null }), person(us)])

  const { result } = await act({ action: 'overview' })
  assert.equal(result.accounts.length, 4)
  assert.equal(result.businesses.length, 3, 'every business is listed, ours included')
  assert.equal(result.weeks.length, 12); assert.equal(result.months.length, 12)
  const listed = result.businesses.find(item => item.id === cafe.id)
  assert.equal(listed.answers.approved, 1); assert.equal(listed.answers.drafts, 1); assert.equal(listed.answers.read, 2)
  assert.equal(listed.activity.read7, 2); assert.equal(listed.activity.liveDays7, 1)
  assert.equal(listed.enquiries.total, 2); assert.equal(listed.enquiries.withEmail, 1)
  assert.equal(listed.scans.total, 1)
  assert.equal(listed.notifyEmail, 'jo@joescafe.com.au')
  const text = JSON.stringify(result)
  for (const secret of ['back room', 'nut free', 'visitor@example.net']) assert.ok(!text.includes(secret), `the overview never carries “${secret}”`)
  assert.ok(!text.includes(cafe.verificationToken), 'nor a business’s verification token')

  const summary = summarise(result)
  assert.equal(summary.totals.businesses, 2, 'ours counts in no total')
  assert.equal(summary.totals.signIns, 2, 'our own sign-in and the code never entered are left out')
  assert.deepEqual(summary.funnels.accounts.map(step => step.count), [3, 2, 2])
  assert.deepEqual(summary.funnels.businesses.map(step => step.count), [2, 1, 1, 1, 1, 1])
  const stages = Object.fromEntries(summary.businesses.map(item => [item.name, item.stage.key]))
  assert.deepEqual(stages, { 'Joe’s Cafe': 'trial', 'The Bakery': 'ended', SayGday: 'internal' })
  assert.equal(summary.totals.trialEnded, 1); assert.equal(summary.totals.inTrial, 1)
  assert.deepEqual([summary.totals.trialToPaid, summary.totals.trialFinished], [0, 1], 'the one business past its free days isn’t paying yet')
  assert.match(investorSummary(summary), /Trial to paid: 0% \(0 of 1 businesses whose free 14 days are over, or that already pay\)/)
  assert.equal(summary.totals.answersRead, 2); assert.equal(summary.totals.questions30, 2)
  assert.equal(summary.weeks.at(-1).businesses, 1, 'this week’s new business; the bakery came earlier and ours counts nowhere')
  assert.equal(summary.weeks.at(-1).answersRead, 2)
  assert.equal(summary.weeks.at(-1).tracked, true)
  assert.match(investorSummary(summary), /Businesses: 2 \(2 new in the last 30 days\)/)
})

test('a business in full: its answers, scans, use and plan, its owner’s sign-in, and when customers asked, never what or who', async () => {
  const { pg, db, call, act } = await platform()
  const jo = await user(pg, 'jo@joescafe.com.au')
  const cafe = await call('create_business', { p_user: jo.id, p_email: jo.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })
  const other = await call('create_business', { p_user: jo.id, p_email: jo.email, p_website: 'https://joesbar.com.au', p_name: 'Joe’s Bar' })
  await call('mark_website_verified', { p_slug: cafe.slug, p_website: cafe.website, p_method: 'dns' })
  const faq = await call('save_faq', { p_user: jo.id, p_business: cafe.id, p_id: null, p_question: 'When are you open?', p_answer: '7am to 3pm.' })
  await call('faq_viewed', { p_slug: cafe.slug, p_faq: faq.id })
  await call('ask_team_queued', { p_slug: cafe.slug, p_question: 'Can I bring my dog Biscuit?', p_email: 'dog.owner@example.net' })
  signIns(db, [person(jo)])

  const { result } = await act({ action: 'business', business: cafe.id })
  assert.equal(result.business.name, 'Joe’s Cafe'); assert.equal(result.business.verifiedBy, 'dns')
  assert.equal(result.owner.email, 'jo@joescafe.com.au')
  assert.deepEqual(result.otherBusinesses.map(item => item.name), ['Joe’s Bar'])
  assert.deepEqual(result.faqs.map(item => [item.question, item.answer, item.views]), [['When are you open?', '7am to 3pm.', 1]], 'the business’s own answers')
  assert.equal(result.activity.length, 60); assert.equal(result.activity.at(-1).answersRead, 1)
  assert.deepEqual(result.enquiries.map(item => [item.leftEmail, item.delivery, item.status]), [[true, 'pending', 'new']])
  const text = JSON.stringify(result)
  for (const secret of ['Biscuit', 'dog.owner@example.net', cafe.verificationToken]) assert.ok(!text.includes(secret), `never “${secret}”`)
  assert.equal(result.otherBusinesses[0].id, other.id)
  await refused(act({ action: 'business', business: '00000000-0000-4000-8000-000000000000' }), 404, 'NOT_FOUND')
  await refused(act({ action: 'business', business: 'not-an-id' }), 400, 'INVALID_ID')
})

test('marking a business paying counts it in the month’s revenue, and every change is kept', async () => {
  const { pg, call, act } = await platform()
  const jo = await user(pg)
  const cafe = await call('create_business', { p_user: jo.id, p_email: jo.email, p_website: 'https://joescafe.com.au' })
  await refused(act({ action: 'setPlan', business: cafe.id, plan: 'free forever' }), 400, 'INVALID')
  await assert.rejects(call('admin_set_plan', { p_business: cafe.id, p_plan: 'gold' }), /INVALID_PLAN/)
  assert.equal((await act({ action: 'setPlan', business: cafe.id, plan: 'paying' })).result.business.plan, 'paying')
  await act({ action: 'setPlan', business: cafe.id, plan: 'paying' })
  assert.equal((await pg.query('select count(*)::int as n from public.plan_changes')).rows[0].n, 1, 'the same plan again is no change')
  const trends = await call('admin_trends', { p_weeks: 4, p_months: 3 })
  assert.equal(trends.months.at(-1).paying, 1, 'paying this month')
  assert.equal(trends.months.at(-2).paying, 0, 'and not last month')
  await act({ action: 'setPlan', business: cafe.id, plan: 'cancelled' })
  assert.equal((await call('admin_trends', { p_weeks: 4, p_months: 3 })).months.at(-1).paying, 0)
  const history = (await act({ action: 'business', business: cafe.id })).result.plans
  assert.deepEqual(history.map(item => item.plan), ['cancelled', 'paying'], 'newest first')
  // Settings the owner changes in their own dashboard are untouched.
  const row = (await pg.query('select plan, updated_at = created_at as untouched from public.businesses where id = $1', [cafe.id])).rows[0]
  assert.deepEqual(row, { plan: 'cancelled', untouched: true })
})

test('answers read and button loads are counted by the day, as numbers only', async () => {
  const { pg, call } = await platform()
  const jo = await user(pg)
  const cafe = await call('create_business', { p_user: jo.id, p_email: jo.email, p_website: 'https://joescafe.com.au' })
  const faq = await call('save_faq', { p_user: jo.id, p_id: null, p_question: 'When are you open?', p_answer: '7am to 3pm.' })
  assert.equal(await call('faq_viewed', { p_slug: cafe.slug, p_faq: faq.id }), false, 'not on a website proved to be theirs')
  assert.equal(await call('button_seen', { p_slug: cafe.slug }), false)
  assert.equal((await pg.query('select count(*)::int as n from public.business_activity')).rows[0].n, 0)
  await call('mark_website_verified', { p_slug: cafe.slug, p_website: cafe.website, p_method: 'button' })
  for (let index = 0; index < 3; index++) assert.equal(await call('faq_viewed', { p_slug: cafe.slug, p_faq: faq.id }), true)
  assert.equal(await call('button_seen', { p_slug: cafe.slug }), true)
  assert.equal(await call('button_seen', { p_slug: cafe.slug }), false, 'still at most once an hour')
  const rows = (await pg.query(`select answers_read, button_hours, day = (now() at time zone 'Australia/Sydney')::date as today from public.business_activity`)).rows
  assert.deepEqual(rows, [{ answers_read: 3, button_hours: 1, today: true }], 'one row a business a day, on Canberra’s calendar')
  assert.equal((await call('list_faqs', { p_user: jo.id }))[0].views, 3, 'the answer’s own count still counts')
  const columns = (await pg.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'business_activity' order by ordinal_position`)).rows.map(row => row.column_name)
  assert.deepEqual(columns, ['business_id', 'day', 'answers_read', 'button_hours'], 'nothing about a visitor can be kept')
  const privacy = (await readFile(new URL('../site/privacy.html', import.meta.url), 'utf8')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.ok(privacy.includes('We only count how often each answer is opened, not who opened it.'), 'what the privacy page promises')
  const migration = await readFile(new URL('../supabase/migrations/20261005100000_admin_dashboard.sql', import.meta.url), 'utf8')
  assert.match(migration, /update public\.businesses set plan = 'internal', plan_changed_at = now\(\) where slug = 'saygday'/, 'SayGday’s own chat counts in no total')
})

test('where a business is in its free 14 days, and how far it has got', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  const ago = days => new Date(now - days * DAY).toISOString()
  assert.equal(TRIAL_DAYS, 14); assert.equal(PRICE, 30)
  assert.deepEqual([stageOf({ createdAt: ago(0) }, now).label, stageOf({ createdAt: ago(0) }, now).daysLeft], ['Day 1 of 14', 14])
  assert.deepEqual([stageOf({ createdAt: ago(5.5) }, now).key, stageOf({ createdAt: ago(5.5) }, now).label], ['trial', 'Day 6 of 14'])
  assert.deepEqual([stageOf({ createdAt: ago(11.5) }, now).key, stageOf({ createdAt: ago(11.5) }, now).daysLeft], ['ending', 3])
  assert.equal(stageOf({ createdAt: ago(13.9) }, now).label, 'Day 14 of 14')
  assert.deepEqual([stageOf({ createdAt: ago(14) }, now).key, stageOf({ createdAt: ago(14) }, now).label], ['ended', 'Trial ended today'])
  assert.equal(stageOf({ createdAt: ago(15.2) }, now).label, 'Trial ended 1 day ago')
  assert.equal(stageOf({ createdAt: ago(40) }, now).label, 'Trial ended 26 days ago')
  assert.equal(stageOf({ createdAt: ago(40), plan: 'paying' }, now).key, 'paying', 'the plan the owner sets wins')
  assert.equal(stageOf({ createdAt: ago(2), plan: 'internal' }, now).key, 'internal')
  assert.equal(stageOf({ createdAt: ago(0) }, now).endsAt, new Date(now + 14 * DAY).toISOString())

  const business = { answers: { approved: 0, drafts: 0, read: 0 } }
  assert.deepEqual(progressOf(business).next.key, 'drafted')
  assert.equal(progressOf({ ...business, answers: { approved: 3, drafts: 2, read: 0 }, websiteVerifiedAt: ago(1) }).next.key, 'live')
  assert.equal(progressOf({ answers: { approved: 3, read: 9 }, websiteVerifiedAt: ago(1), buttonSeenAt: ago(0) }).next, null)
  assert.equal(progressOf({ answers: { approved: 0, drafts: 0, read: 0 }, websiteVerifiedAt: ago(1) }).done, 1, 'steps count in order')

  // Canberra's calendar: 2:30am on Monday 5 October there is still Sunday in UTC.
  assert.equal(sydneyDay('2026-10-04T15:30:00Z'), '2026-10-05')
  assert.equal(mondayOf('2026-10-11'), '2026-10-05'); assert.equal(mondayOf('2026-10-05'), '2026-10-05')
})

test('the spreadsheet of businesses can’t run anything a business typed', () => {
  assert.equal(csvCell('=HYPERLINK("https://evil.example","Click")'), `"'=HYPERLINK(""https://evil.example"",""Click"")"`)
  for (const start of ['+', '-', '@', '\t', '\r']) assert.ok(csvCell(`${start}1+1`).replace(/^"/, '').startsWith(`'${start}`), JSON.stringify(start))
  assert.equal(csvCell('Joe’s Cafe, Canberra'), '"Joe’s Cafe, Canberra"')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
  assert.equal(csvCell(null), ''); assert.equal(csvCell(12), '12')
  const now = Date.now()
  const summary = summarise({ generatedAt: new Date(now).toISOString(), accounts: [{ id: 'u1', email: 'jo@joescafe.com.au', createdAt: new Date(now).toISOString(), confirmed: true }],
    businesses: [{ id: 'b1', ownerId: 'u1', name: '=cmd|calc', website: 'https://joescafe.com.au', plan: 'trial', createdAt: new Date(now).toISOString(),
      answers: { approved: 1, drafts: 0, read: 4 }, enquiries: { total: 1, last30: 1 }, scans: { total: 1 }, activity: { read7: 4 } }], weeks: [], months: [] })
  const lines = businessesCsv(summary).trimEnd().split('\r\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[0], CSV_COLUMNS.join(','))
  assert.ok(lines[1].startsWith(`'=cmd|calc,https://joescafe.com.au,jo@joescafe.com.au,`))
})

test('every sign-in is read, however many pages Supabase hands them out in', async () => {
  const many = Array.from({ length: 2345 }, (_, index) => ({ id: `u${index}`, email: `p${index}@example.com`, email_confirmed_at: index % 2 ? null : '2026-10-05T00:00:00Z' }))
  const pages = []
  const db = { auth: { admin: { listUsers: async ({ page, perPage }) => { pages.push(page); return { data: { users: many.slice((page - 1) * perPage, page * perPage), total: many.length }, error: null } } } } }
  const accounts = await listAccounts(db)
  assert.equal(accounts.length, 2345); assert.deepEqual(pages, [1, 2, 3])
  assert.deepEqual(accounts[1], { id: 'u1', email: 'p1@example.com', createdAt: null, lastSignInAt: null, confirmed: false })
  await assert.rejects(listAccounts({ auth: { admin: { listUsers: async () => ({ data: null, error: { status: 500 } }) } } }), error => error.code === 'AUTH_UNAVAILABLE')
})

test('the admin page is its own address, never indexed or framed, fetches nothing from Google, and its password stays on the server', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  const toml = await read('netlify.toml')
  assert.match(toml, /from = "\/admin\/\*"\n\s+to = "\/admin\.html"\n\s+status = 200/)
  assert.match(toml, /from = "\/admin"\n\s+to = "\/admin\.html"\n\s+status = 200/)
  for (const path of ['/admin', '/admin/*', '/admin.html'])
    assert.match(toml, new RegExp(`for = "${path.replace(/[.*/]/g, '\\$&')}"\\n  \\[headers\\.values\\]\\n    X-Robots-Tag = "noindex, nofollow"`), `${path} is never indexed`)
  assert.match(toml, /for = "\/\*"[\s\S]*?frame-ancestors 'none'/, 'and never framed (the site-wide policy)')
  const html = await read('admin.html')
  assert.match(html, /<meta name="robots" content="noindex, nofollow" \/>/)
  assert.doesNotMatch(html, /googleapis|gstatic/, 'its typeface is bundled')
  assert.match(await read('vite.config.js'), /admin: 'admin\.html'/)
  assert.match(await read('site/vite-plugin.mjs'), /clean === '\/admin' \|\| clean\.startsWith\('\/admin\/'\)/, '`vite` serves it at /admin too')
  const files = async folder => (await readdir(new URL(`../${folder}`, import.meta.url), { recursive: true })).filter(name => /\.(jsx?|mjs|html|css)$/.test(name)).map(name => `${folder}${name}`)
  for (const file of [...await files('src/'), 'admin.html', 'app.html', 'chat.html'])
    assert.doesNotMatch(await read(file), /SAYGDAY_ADMIN_PASSWORD/, `${file}: the password is the server’s alone`)
  assert.match(await read('docs/setup.md'), /`SAYGDAY_ADMIN_PASSWORD`/, 'setting it up is in the instructions')
})
