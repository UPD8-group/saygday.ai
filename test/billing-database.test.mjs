import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { database, rpcClient, user } from './helpers/database.mjs'

async function setup({ policy, verified = true } = {}) {
  const pg = await database({ cardRequired: false })
  const owner = await user(pg)
  const db = rpcClient(pg)
  const call = async (name, args = {}) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    return data
  }
  const business = await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://billingcafe.com.au' })
  if (verified) await call('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  if (policy) await activate(pg, policy)
  const account = () => call('billing_owner', { p_user: owner.id })
  const lease = () => call('billing_acquire', { p_business: business.id })
  const commit = (token, args) => call('billing_commit', { p_business: business.id, p_lease: token, ...args })
  return { pg, owner, business, call, account, lease, commit }
}
const activate = (pg, policy) => pg.query('update public.billing_settings set trial_start_policy=$1, enabled=true where singleton', [policy])
// Explicit fixture time travel: production rejects changing these timestamps.
async function expireTrial(pg, businessId) {
  await pg.exec('alter table public.billing_accounts disable trigger billing_accounts_immutable')
  await pg.query("update public.billing_accounts set trial_started_at=now()-interval '15 days', trial_ends_at=now()-interval '1 day' where business_id=$1", [businessId])
  await pg.exec('alter table public.billing_accounts enable trigger billing_accounts_immutable')
}
const paidState = () => ({ stripe_customer_id: 'cus_owned123', stripe_subscription_id: 'sub_owned123',
  subscription_status: 'active', price_valid: true, cancel_at_period_end: false,
  current_period_end: new Date(Date.now() + 86400000).toISOString(), synced_at: new Date().toISOString() })

test('billing migration records the chosen verification policy, stays inert, and protects already-verified businesses on activation', async () => {
  const { pg, business, account, call } = await setup()
  const before = await account()
  assert.equal(before.enabled, false)
  assert.equal(before.trial_start_policy, 'website_verified')
  assert.equal(before.trial_started_at, null)
  assert.equal(before.access_allowed, true)
  assert.ok(await call('widget', { p_slug: business.slug }))
  await assert.rejects(pg.exec('update public.billing_settings set trial_start_policy=null, enabled=true where singleton'), /BILLING_POLICY_REQUIRED/)
  await pg.query("update public.billing_accounts set first_website_verified_at=now()-interval '89 days' where business_id=$1", [business.id])
  await pg.exec('update public.billing_settings set enabled=true where singleton')
  const after = await account()
  const settings = (await pg.query('select activated_at from public.billing_settings')).rows[0]
  assert.equal(new Date(after.trial_started_at).getTime(), new Date(settings.activated_at).getTime())
  assert.equal(new Date(after.trial_ends_at) - new Date(after.trial_started_at), 14 * 86400000)
  assert.equal(after.access_allowed, true)
  assert.equal(after.access_reason, 'trial')
  await assert.rejects(pg.query("update public.billing_accounts set trial_ends_at=trial_ends_at+interval '1 day' where business_id=$1", [business.id]), /BILLING_TRIAL_IMMUTABLE/)
  await assert.rejects(pg.exec("update public.billing_settings set trial_start_policy='account_created'"), /BILLING_POLICY_IMMUTABLE/)
  await pg.exec('update public.billing_settings set enabled=false; update public.billing_settings set enabled=true;')
  assert.equal((await account()).trial_ends_at, after.trial_ends_at)
})

test('the selected policy never starts on signup, website entry or scans; first successful verification starts exactly 14 days', async () => {
  const pg = await database({ cardRequired: false })
  await pg.exec('update public.billing_settings set enabled=true where singleton')
  const owner = await user(pg)
  await pg.exec('set role service_role')
  const db = rpcClient(pg)
  const invoke = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    assert.equal(error, null, name)
    return data
  }
  assert.equal(await invoke('my_business', { p_user: owner.id }), null)
  const business = await invoke('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://verifiedtrial.com.au' })
  const account = () => invoke('billing_owner', { p_user: owner.id })
  assert.equal((await account()).trial_start_policy, 'website_verified')
  assert.equal((await account()).trial_started_at, null)
  await invoke('start_scan', { p_user: owner.id, p_website: business.website })
  assert.equal((await account()).trial_started_at, null, 'drafting answers does not consume the trial')
  assert.equal((await account()).access_allowed, false, 'unverified public chat remains unavailable')
  await invoke('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  const verified = await account()
  assert.equal(verified.trial_started_at, verified.first_website_verified_at)
  assert.equal(new Date(verified.trial_ends_at) - new Date(verified.trial_started_at), 14 * 86400000)
  assert.equal(verified.access_allowed, true)
  await invoke('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'dns' })
  assert.equal((await account()).trial_ends_at, verified.trial_ends_at, 'a second verification cannot reset the clock')
  await pg.exec('reset role')
})

test('verification policy permits setup, starts once on proof, and survives domain replacement without a fresh trial', async () => {
  const { pg, owner, business, account, call } = await setup({ policy: 'website_verified', verified: false })
  assert.equal((await account()).trial_started_at, null)
  assert.equal((await account()).access_reason, 'trial_not_started')
  await call('start_scan', { p_user: owner.id, p_website: business.website })
  await pg.exec("update public.scans set status='done'")
  await call('start_scan', { p_user: owner.id, p_website: business.website })
  await call('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'dns' })
  const original = await account()
  assert.equal(original.access_allowed, true)
  assert.ok(original.first_website_verified_at)
  await pg.query("update public.businesses set website='https://newbillingcafe.com.au' where id=$1", [business.id])
  await call('mark_website_verified', { p_slug: business.slug, p_website: 'https://newbillingcafe.com.au', p_method: 'dns' })
  const moved = await account()
  assert.equal(moved.trial_started_at, original.trial_started_at)
  assert.equal(moved.trial_ends_at, original.trial_ends_at)
  assert.equal(moved.first_website_verified_at, original.first_website_verified_at)
})

test('account and business creation policies use actual timestamps through service_role invoker RPCs', async () => {
  for (const policy of ['account_created', 'business_created']) {
    const pg = await database({ cardRequired: false })
    await activate(pg, policy)
    const owner = await user(pg)
    await pg.exec('set role service_role')
    const db = rpcClient(pg)
    const created = await db.rpc('create_business', { p_user: owner.id, p_email: owner.email, p_website: `https://${policy.replaceAll('_', '-')}.com.au` })
    assert.equal(created.error, null)
    const { data: account, error } = await db.rpc('billing_owner', { p_user: owner.id })
    assert.equal(error, null)
    assert.equal(account.trial_started_at, account[`${policy}_at`])
    assert.equal(account.access_allowed, true)
    const impostor = await db.rpc('billing_owner', { p_user: randomUUID() })
    assert.equal(impostor.error.message, 'NO_BUSINESS')
    await assert.rejects(pg.query('select email from auth.users'), /permission denied/)
    await pg.exec('reset role')
  }
})

test('expired trial blocks every visitor path and rescans while preserving owner answers and saved enquiries', async () => {
  const { pg, owner, business, call, account } = await setup({ policy: 'business_created' })
  const faq = await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'Do you have coffee?', p_answer: 'Yes, all day.', p_status: 'approved' })
  await call('ask_team', { p_slug: business.slug, p_question: 'Can I book a table?' })
  await call('start_scan', { p_user: owner.id, p_website: business.website })
  await expireTrial(pg, business.id)
  assert.equal((await account()).access_allowed, false)
  assert.equal((await account()).access_reason, 'trial_expired')
  assert.equal(await call('widget', { p_slug: business.slug }), null)
  assert.equal(await call('chat_website', { p_slug: business.slug }), null)
  assert.equal(await call('faq_viewed', { p_slug: business.slug, p_faq: faq.id }), false)
  assert.equal(await call('button_seen', { p_slug: business.slug }), false)
  await assert.rejects(call('ask_team', { p_slug: business.slug, p_question: 'New enquiry?' }), /NOT_FOUND/)
  await assert.rejects(call('ask_team_queued', { p_slug: business.slug, p_question: 'New enquiry?', p_email: 'a@example.com' }), /NOT_FOUND/)
  assert.equal((await pg.query('select count(*)::integer as n from public.enquiry_notifications')).rows[0].n, 0)
  await assert.rejects(call('start_scan', { p_user: owner.id, p_website: business.website }), /BILLING_REQUIRED/)
  assert.equal((await call('list_enquiries', { p_user: owner.id })).length, 1)
  const changed = await call('save_faq', { p_user: owner.id, p_id: faq.id, p_question: null, p_answer: 'Yes, until 2 pm.' })
  assert.equal(changed.answer, 'Yes, until 2 pm.')
  assert.ok(await call('my_business', { p_user: owner.id }))
})

test('only a fresh, correctly priced active subscription grants paid access; every failed state still honours the original trial', async () => {
  const { pg, business, account, lease, commit, call } = await setup({ policy: 'business_created' })
  const held = await lease()
  const original = await account()
  for (const status of ['none','incomplete','incomplete_expired','trialing','past_due','canceled','unpaid','paused','conflict']) {
    const saved = await commit(held.lease, { p_state: { ...paidState(), subscription_status: status } })
    assert.equal(saved.account.access_allowed, true, `${status} cannot take away unexpired no-card trial`)
    assert.equal(saved.account.trial_ends_at, original.trial_ends_at)
  }
  await expireTrial(pg, business.id)
  for (const status of ['none','incomplete','incomplete_expired','trialing','past_due','canceled','unpaid','paused','conflict']) {
    assert.equal((await commit(held.lease, { p_state: { ...paidState(), subscription_status: status } })).account.access_allowed, false, status)
  }
  const active = await commit(held.lease, { p_state: { ...paidState(), cancel_at_period_end: true } })
  assert.equal(active.account.access_allowed, true, 'commit response is usable immediately in its transaction')
  assert.equal(active.account.access_reason, 'subscription')
  assert.ok(await call('widget', { p_slug: business.slug }))
  assert.equal((await commit(held.lease, { p_state: { price_valid: false } })).account.access_allowed, false)
  await commit(held.lease, { p_state: paidState() })
  await pg.query("update public.billing_accounts set synced_at=now()-interval '25 hours' where business_id=$1", [business.id])
  assert.equal((await account()).access_allowed, false)
  assert.equal((await account()).access_reason, 'billing_unavailable')
  await commit(held.lease, { p_state: { ...paidState(), current_period_end: new Date(Date.now() - 1000).toISOString() } })
  assert.equal((await account()).access_allowed, false, 'a cancelled-at-period-end plan does not overrun its period')
  await pg.exec('delete from public.billing_settings')
  assert.equal(await call('billing_access', { p_business: business.id }), false, 'missing global settings cannot bypass billing')
})

test('leases fence races, expired workers cannot commit or release a new lease, and Checkout survives response loss', async () => {
  const { pg, business, lease, commit, call, account } = await setup({ policy: 'business_created' })
  const racers = await Promise.all([lease(), lease()])
  assert.equal(racers.filter(Boolean).length, 1)
  const held = racers.find(Boolean)
  const checkout = { customer_key: 'customer-operation-1', key: 'checkout-operation-1', created_at: new Date().toISOString(),
    params: { mode: 'subscription', line_items: [{ price: 'price_owned', quantity: 1 }] }, session_id: 'cs_owned123',
    expires_at: Math.floor(Date.now() / 1000) + 3600, url: 'https://checkout.stripe.com/c/pay/cs_owned123' }
  await commit(held.lease, { p_checkout: checkout })
  await pg.query("update public.billing_accounts set lease_until=now()-interval '1 second' where business_id=$1", [business.id])
  const recovered = await lease()
  assert.notEqual(recovered.lease, held.lease)
  assert.deepEqual(recovered.account.checkout, checkout, 'new worker recovers the exact Checkout params and operation key')
  await assert.rejects(commit(held.lease, { p_state: paidState(), p_event_id: 'evt_stale123', p_event_type: 'invoice.paid' }), /BILLING_LEASE_LOST/)
  assert.equal(await call('billing_event_seen', { p_event_id: 'evt_stale123' }), false)
  assert.equal(await call('billing_release', { p_business: business.id, p_lease: held.lease }), false)
  assert.equal(await lease(), null, 'a stale release cannot unlock its replacement')
  await commit(recovered.lease, { p_state: paidState() })
  assert.deepEqual((await account()).checkout, checkout)
  await commit(recovered.lease, { p_checkout: {} })
  assert.deepEqual((await account()).checkout, {})
  assert.equal(await call('billing_release', { p_business: business.id, p_lease: recovered.lease }), true)
})

test('event receipt and billing state commit atomically, duplicates cannot rewind state, and customer links are unique and immutable', async () => {
  const { pg, business, lease, commit, call, account } = await setup({ policy: 'business_created' })
  const held = await lease()
  const event = { p_event_id: 'evt_atomic123', p_event_type: 'customer.subscription.updated' }
  await assert.rejects(commit(held.lease, { ...event, p_state: { subscription_status: 'invalid' } }), /check constraint/)
  assert.equal(await call('billing_event_seen', { p_event_id: event.p_event_id }), false)
  const saved = await commit(held.lease, { ...event, p_state: paidState() })
  assert.equal(saved.duplicate, false)
  const duplicate = await commit(held.lease, { ...event, p_state: { subscription_status: 'canceled' } })
  assert.equal(duplicate.duplicate, true)
  assert.equal((await account()).subscription_status, 'active')
  assert.equal((await pg.query('select count(*)::integer as n from public.billing_events')).rows[0].n, 1)
  await assert.rejects(commit(held.lease, { p_state: { stripe_customer_id: 'cus_other123' } }), /BILLING_CUSTOMER_IMMUTABLE/)
  const anotherOwner = await user(pg)
  const another = await call('create_business', { p_user: anotherOwner.id, p_email: anotherOwner.email, p_website: 'https://anotherbilling.com.au' })
  const otherLease = await call('billing_acquire', { p_business: another.id })
  await assert.rejects(call('billing_commit', { p_business: another.id, p_lease: otherLease.lease, p_state: { stripe_customer_id: paidState().stripe_customer_id } }), /unique constraint/)
  assert.equal((await call('billing_by_customer', { p_customer: 'cus_owned123' })).business_id, business.id)
})

test('reconciliation selects oldest stale customers without leaking state or grants to browser roles', async () => {
  const { pg, business, lease, commit, call } = await setup({ policy: 'business_created' })
  assert.deepEqual(await call('billing_reconcile_batch'), [])
  const held = await lease()
  await commit(held.lease, { p_state: paidState() })
  assert.deepEqual(await call('billing_reconcile_batch'), [])
  await pg.query("update public.billing_accounts set synced_at=now()-interval '13 hours' where business_id=$1", [business.id])
  assert.equal((await call('billing_reconcile_batch'))[0].business_id, business.id)
  await call('billing_release', { p_business: business.id, p_lease: held.lease })
  const nextOwner = await user(pg)
  const nextBusiness = await call('create_business', { p_user: nextOwner.id, p_email: nextOwner.email, p_website: 'https://nextbillingcafe.com.au' })
  const nextLease = await call('billing_acquire', { p_business: nextBusiness.id })
  await call('billing_commit', { p_business: nextBusiness.id, p_lease: nextLease.lease,
    p_state: { ...paidState(), stripe_customer_id: 'cus_next123', stripe_subscription_id: 'sub_next123' } })
  await call('billing_release', { p_business: nextBusiness.id, p_lease: nextLease.lease })
  await pg.exec("update public.billing_accounts set synced_at=now()-interval '13 hours', last_reconcile_attempt_at=now()-interval '1 day'")
  await pg.query("update public.billing_accounts set last_reconcile_attempt_at=now()-interval '2 days' where business_id=$1", [business.id])
  assert.equal((await call('billing_reconcile_batch', { p_limit: 1 }))[0].business_id, business.id)
  const failedAttempt = await lease()
  await call('billing_release', { p_business: business.id, p_lease: failedAttempt.lease })
  assert.equal((await call('billing_reconcile_batch', { p_limit: 1 }))[0].business_id, nextBusiness.id,
    'failed Stripe reads rotate behind other stale accounts rather than starving the batch')
  for (const role of ['anon','authenticated']) {
    await pg.exec(`set role ${role}`)
    await assert.rejects(pg.query('select * from public.billing_accounts'), /permission denied/)
    await assert.rejects(pg.query('select public.billing_by_business($1)', [business.id]), /permission denied/)
    await assert.rejects(pg.query('select public.billing_acquire($1)', [business.id]), /permission denied/)
    await assert.rejects(pg.query("update public.billing_settings set enabled=false"), /permission denied/)
    await pg.exec('reset role')
  }
  const rls = (await pg.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('billing_accounts','billing_settings','billing_events')")).rows
  assert.equal(rls.length, 3)
  assert.ok(rls.every(row => row.relrowsecurity))
  const functions = (await pg.query("select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'billing_%'")).rows
  assert.ok(functions.every(row => !row.prosecdef), 'billing functions remain security invoker')
})

