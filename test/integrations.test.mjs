import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes, createHash } from 'node:crypto'
import { database, rpcClient, user } from './helpers/database.mjs'
import { integrationAction, pkceChallenge, connectionRequest, STUDIO_CALLBACK } from '../netlify/functions/_lib/integrations.mjs'
import { studioReturnPath } from '../src/app/login-helpers.js'

const bearer = token => new Request('https://saygday.ai/api/integrations', { method: 'POST', headers: { authorization: `Bearer ${token}` } })
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code)
const sha = value => createHash('sha256').update(value).digest('hex')
async function setup() {
  const pg = await database(), owner = await user(pg), other = await user(pg)
  await pg.exec('alter table auth.users add column email_confirmed_at timestamptz default now(), add column banned_until timestamptz, add column deleted_at timestamptz')
  await pg.exec('create function auth.uid() returns uuid language sql as $$select null::uuid$$')
  const db = rpcClient(pg, { user: owner })
  let active = owner
  db.auth.admin = { getUserById: async id => ({ data: { user: active?.id === id ? active : null }, error: null }) }
  const call = async (name, args) => { const { data, error } = await db.rpc(name, args); if (error) throw new Error(error.message); return data }
  const business = await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://santasecret.com.au' })
  await call('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  const act = (body, token = 'owner') => integrationAction({ request: bearer(token), db, body, read: () => undefined, ip: 'test-ip' })
  const authorize = async (extras = {}) => {
    const codeVerifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url')
    const result = await act({ action: 'authorize', business: business.id, state, codeChallenge: pkceChallenge(codeVerifier), redirectUri: STUDIO_CALLBACK, ...extras })
    const url = new URL(result.redirectUrl)
    assert.equal(url.searchParams.get('state'), state)
    assert.equal(url.origin, 'https://oo.studio')
    return { code: url.searchParams.get('code'), codeVerifier, redirectUri: STUDIO_CALLBACK }
  }
  const connect = async () => act({ action: 'exchange', ...await authorize() })
  return { pg, owner, other, db, business, call, act, authorize, connect, setOwner: value => { active = value } }
}

test('a verified owner connects one business; only hashes are stored; answer and enquiry controls stay scoped', async () => {
  const { pg, owner, other, business, call, act, connect } = await setup()
  const otherBusiness = await call('create_business', { p_user: other.id, p_email: other.email, p_website: 'https://other.example.com' })
  const foreign = await call('save_faq', { p_user: other.id, p_business: otherBusiness.id, p_id: null, p_question: 'Other business question?', p_answer: 'Private' })
  const grant = await connect()
  assert.match(grant.accessToken, /^sgp_[A-Za-z0-9_-]{43}$/)
  assert.equal(grant.business.id, business.id)
  assert.ok(!('verificationToken' in grant.business)); assert.ok(!('notifyEmail' in grant.business))
  const stored = (await pg.query('select * from public.integration_grants')).rows[0]
  assert.equal(stored.token_hash, sha(grant.accessToken)); assert.ok(!JSON.stringify(stored).includes(grant.accessToken))
  assert.equal(stored.owner_id, owner.id)
  assert.equal((await act({ action: 'summary' }, grant.accessToken)).business.id, business.id)
  const { faq } = await act({ action: 'saveFaq', question: 'Can I collect my order?', answer: 'Yes, from the shop.', status: 'approved' }, grant.accessToken)
  assert.equal((await act({ action: 'listFaqs' }, grant.accessToken)).faqs[0].id, faq.id)
  await rejects(act({ action: 'saveFaq', id: foreign.id, answer: 'Hacked' }, grant.accessToken), 'NOT_FOUND')
  await rejects(act({ action: 'listFaqs', business: otherBusiness.id }, grant.accessToken), 'BOUND_BUSINESS')
  for (const action of ['billingCheckout', 'billingPortal', 'updateBusiness', 'deleteEnquiry', 'deleteFaq', 'approveAll', 'createBusiness', 'startScan']) await rejects(act({ action }, grant.accessToken), 'SCOPE_DENIED')
  const enquiry = (await pg.query('insert into public.enquiries(business_id,question,email) values($1,$2,$3) returning id', [business.id, 'Can you help?', 'customer@example.com'])).rows[0]
  assert.equal((await act({ action: 'listEnquiries', status: 'new' }, grant.accessToken)).enquiries[0].id, enquiry.id)
  assert.equal((await act({ action: 'setEnquiry', id: enquiry.id, status: 'done' }, grant.accessToken)).updated, true)
  assert.equal((await act({ action: 'listEnquiries', status: 'done' }, grant.accessToken)).enquiries[0].status, 'done')
  assert.equal((await act({ action: 'revoke' }, grant.accessToken)).revoked, true)
  await rejects(act({ action: 'summary' }, grant.accessToken), 'INTEGRATION_EXPIRED')
})

test('code is single-use, PKCE-bound, short-lived, and cannot redirect to a different site', async () => {
  const { pg, act, authorize } = await setup()
  const code = await authorize()
  await rejects(act({ action: 'exchange', ...code, codeVerifier: 'x'.repeat(43) }), 'INVALID_CONNECTION')
  await rejects(act({ action: 'exchange', ...code, redirectUri: 'https://evil.example/dashboard/' }), 'INVALID_CONNECTION')
  assert.ok((await act({ action: 'exchange', ...code })).accessToken)
  await rejects(act({ action: 'exchange', ...code }), 'INVALID_CONNECTION')
  const old = await authorize()
  await pg.exec("update public.integration_codes set expires_at=now()-interval '1 minute'")
  await rejects(act({ action: 'exchange', ...old }), 'INVALID_CONNECTION')
  await rejects(authorize({ redirectUri: STUDIO_CALLBACK + '&extra=anything' }), 'INVALID_CONNECTION')
})

test('owner transfer, unverified/changed website, expired token and banned/deleted owner invalidate a grant', async () => {
  const { pg, owner, other, business, act, connect, setOwner } = await setup()
  const { accessToken } = await connect()
  setOwner({ ...owner, banned_until: '2099-01-01T00:00:00Z' })
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
  setOwner(null)
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
  setOwner(owner)
  await pg.query('update public.businesses set owner_id=$1 where id=$2', [other.id, business.id])
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
  await pg.query('update public.businesses set owner_id=$1,website_verified_at=null where id=$2', [owner.id, business.id])
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
  await pg.query('update public.businesses set website=$1,website_verified_at=now() where id=$2', ['https://different.example.com', business.id])
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
  await pg.query('update public.businesses set website=$1,website_verified_at=now() where id=$2', [business.website, business.id])
  await pg.exec("update public.integration_grants set expires_at=now()-interval '1 second'")
  await rejects(act({ action: 'listFaqs' }, accessToken), 'INTEGRATION_EXPIRED')
})

test('connections require owned verified businesses and the owner can revoke independently', async () => {
  const { pg, other, business, act, authorize, connect } = await setup()
  await rejects(authorize({ business: other.id }), 'NO_BUSINESS')
  const { accessToken } = await connect()
  const rows = (await act({ action: 'connections', business: business.id })).connections
  assert.equal(rows.length, 1); assert.equal(rows[0].client, 'oo.studio')
  assert.ok(!JSON.stringify(rows).includes('token'))
  assert.equal((await act({ action: 'disconnect', id: rows[0].id })).revoked, true)
  await rejects(act({ action: 'summary' }, accessToken), 'INTEGRATION_EXPIRED')
  await pg.query('update public.businesses set website_verified_at=null where id=$1', [business.id])
  await assert.rejects(authorize())
})

test('a revocation between early lookup and write is rechecked atomically; account and website changes are rechecked too', async () => {
  const { pg, db, owner, business, act, connect } = await setup()
  let grant = await connect(), change = async () => pg.exec('update public.integration_grants set revoked_at=now()')
  const rpc = db.rpc.bind(db)
  db.rpc = async (name, args) => {
    const result = await rpc(name, args)
    if (name === 'rate_limit' && args.p_key.startsWith('integration:')) await change()
    return result
  }
  await rejects(act({ action: 'saveFaq', question: 'Revoked question?', answer: 'Must not save.' }, grant.accessToken), 'INTEGRATION_EXPIRED')
  assert.equal((await pg.query('select count(*)::int n from public.faqs')).rows[0].n, 0)
  grant = await connect()
  change = async () => pg.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [owner.id])
  await rejects(act({ action: 'listFaqs' }, grant.accessToken), 'INTEGRATION_EXPIRED')
  await pg.query('update auth.users set banned_until=null where id=$1', [owner.id])
  change = async () => pg.query('update public.businesses set website_verified_at=null where id=$1', [business.id])
  await rejects(act({ action: 'saveFaq', question: 'Unverified question?', answer: 'Must not save.' }, grant.accessToken), 'INTEGRATION_EXPIRED')
})

test('browser roles cannot access integration tables or execute integration RPCs', async () => {
  const { pg } = await setup()
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['integration_codes', 'integration_grants']) {
      assert.equal((await pg.query('select has_table_privilege($1,$2,$3) as allowed', [role, `public.${table}`, 'SELECT'])).rows[0].allowed, false)
      assert.equal((await pg.query('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0].relrowsecurity, true)
    }
    const rows = (await pg.query("select p.oid from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname like 'integration_%'")).rows
    for (const row of rows) assert.equal((await pg.query('select has_function_privilege($1,$2,$3) as allowed', [role, row.oid, 'EXECUTE'])).rows[0].allowed, false)
    assert.equal((await pg.query("select has_schema_privilege($1,'saygday_private','USAGE') as allowed", [role])).rows[0].allowed, false)
    assert.equal((await pg.query("select has_function_privilege($1,'saygday_private.integration_active_owner(uuid)','EXECUTE') as allowed", [role])).rows[0].allowed, false)
  }
})

test('service role executes scoped actions without SELECT access to auth.users', async () => {
  const { pg, act, connect } = await setup()
  const { accessToken } = await connect()
  assert.equal((await pg.query("select has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed, false)
  await pg.exec('grant usage on schema public to service_role; set role service_role')
  try { assert.equal((await act({ action: 'summary' }, accessToken)).business.website, 'https://santasecret.com.au') }
  finally { await pg.exec('reset role') }
})

test('consent inputs and sign-in continuation reject open redirects and malformed PKCE', () => {
  const body = { state: 's'.repeat(43), codeChallenge: 'c'.repeat(43), redirectUri: STUDIO_CALLBACK }
  assert.equal(connectionRequest(body, () => undefined).redirectUri, STUDIO_CALLBACK)
  for (const value of ['', 'x', 'x'.repeat(42), 'x'.repeat(44), '+'.repeat(43)]) assert.throws(() => connectionRequest({ ...body, codeChallenge: value }, () => undefined))
  for (const value of ['https://evil.example', '//evil.example', '/app?next=https://evil.example', '/app/connect/oo-studio/../evil?x=1', '/app/connect/oo-studio']) assert.equal(studioReturnPath(value), '/app')
  assert.equal(studioReturnPath('/app/connect/oo-studio?state=abc'), '/app/connect/oo-studio?state=abc')
})
