import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { rateLimit, rateLimitKey } from '../netlify/functions/_lib/runtime.mjs'
import { visitorAction } from '../netlify/functions/_lib/visitor.mjs'
import { sendSignInCode } from '../netlify/functions/_lib/sign-in.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'

// The website's privacy page says spam limits use a connection's internet
// address without keeping it. The database only ever holds the kind of limit
// and a scrambled form of the address, and nothing older than a day.
const IP = '203.0.113.77'
const EMAIL = 'jo@joescafe.com.au'

test('a rate limit keeps the kind of limit, never the address it counted', async () => {
  const pg = await database()
  const db = rpcClient(pg)
  const owner = await user(pg)
  const business = (await db.rpc('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })).data
  // The real callers: a sign-in code, a customer reading an answer, and a
  // customer asking the team.
  db.auth.admin = { generateLink: async ({ email }) => ({ data: { properties: { email_otp: '482913', hashed_token: 'abc123' }, user: { email } }, error: null }) }
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) })
  await sendSignInCode({ db, body: { email: EMAIL }, ip: IP, configuration: { configured: true, key: 're_test', from: 'SayGday <hello@saygday.ai>', publicUrl: 'https://saygday.ai' }, fetchImpl })
  await visitorAction({ db, body: { business: business.slug, action: 'viewed', faqId: randomUUID() }, ip: IP }).catch(() => {})
  await visitorAction({ db, body: { business: business.slug, action: 'ask', question: 'Do you open on Sundays?', email: EMAIL }, ip: IP }).catch(() => {})
  const keys = (await pg.query('select key from public.rate_limits order by key')).rows.map(row => row.key)
  assert.deepEqual(keys.map(key => key.slice(0, key.lastIndexOf(':'))).sort(), ['ask', 'ask-business', 'sign-in:email', 'sign-in:email-minute', 'sign-in:ip', 'viewed'])
  for (const key of keys) {
    assert.match(key, /^[a-z:-]+:[A-Za-z0-9_-]{32}$/)
    for (const secret of [IP, EMAIL, Buffer.from(IP).toString('base64url'), Buffer.from(EMAIL).toString('base64url'), business.slug]) {
      assert.ok(!key.includes(secret), `${key} doesn’t carry ${secret}`)
    }
  }
  assert.equal(rateLimitKey('ask', IP), rateLimitKey('ask', IP), 'the same address is counted together')
  assert.notEqual(rateLimitKey('ask', IP), rateLimitKey('ask', '203.0.113.78'))
  assert.notEqual(rateLimitKey('ask', IP, 'one secret'), rateLimitKey('ask', IP, 'another'), 'scrambled with a secret, so it can’t be worked back by trying every address')
})

test('a limit still counts, and rows older than a day are cleared', async () => {
  const pg = await database()
  const db = rpcClient(pg)
  for (let index = 0; index < 3; index++) await rateLimit(db, 'ask', IP, 3, 3600)
  await assert.rejects(rateLimit(db, 'ask', IP, 3, 3600), error => error.status === 429)
  await rateLimit(db, 'ask', '198.51.100.1', 3, 3600)
  await pg.query(`update public.rate_limits set window_started_at = window_started_at - interval '25 hours' where key = $1`, [rateLimitKey('ask', '198.51.100.1')])
  await rateLimit(db, 'owner', randomUUID(), 120, 60)
  const left = (await pg.query('select key from public.rate_limits')).rows.map(row => row.key)
  assert.ok(!left.includes(rateLimitKey('ask', '198.51.100.1')), 'a day-old row is gone')
  assert.ok(left.includes(rateLimitKey('ask', IP)), 'a live limit stays')
})

test('the privacy page promises what the code does', async () => {
  const page = (await readFile(new URL('../site/privacy.html', import.meta.url), 'utf8')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  assert.ok(page.includes('We keep only a scrambled form that can’t be turned back into the address, and clear it within a day.'), 'Stopping spam')
  assert.ok(page.includes('When you ask for a sign-in code, your email and internet address in a scrambled form'), 'sign-in limits')
  const migration = await readFile(new URL('../supabase/migrations/20261002130000_rate_limits_keep_no_addresses.sql', import.meta.url), 'utf8')
  assert.match(migration, /delete from public\.rate_limits where window_started_at < clock_timestamp\(\) - interval '1 day';/, '“within a day” is the database’s own rule')
})
