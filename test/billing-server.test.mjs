import assert from 'node:assert/strict'
import test from 'node:test'
import Stripe from 'stripe'
import { database, user, rpcClient } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { billingConfiguration, createStripe, stripeUrl, exactPrice, publicBilling, billingCheckout, billingPortal, billingStatus,
  subscriptionSnapshot, stripeWebhook, reconcileAccount, reconcileBillingBatch, STRIPE_API_VERSION } from '../netlify/functions/_lib/billing.mjs'

const settings = { SAYGDAY_STRIPE_SECRET_KEY: 'sk_test_example', SAYGDAY_STRIPE_MODE: 'test', SAYGDAY_STRIPE_PRICE_ID: 'price_monthly',
  SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_safe', SAYGDAY_STRIPE_WEBHOOK_SECRET: 'whsec_example', SAYGDAY_PUBLIC_URL: 'https://saygday.ai' }
const configuration = billingConfiguration(name => settings[name])
const now = () => Math.floor(Date.now() / 1000)
const price = () => ({ id: 'price_monthly', active: true, livemode: false, currency: 'aud', unit_amount: 3000, tax_behavior: 'inclusive',
  type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } })
const subscription = (overrides = {}) => ({ id: 'sub_plan', customer: 'cus_owner', created: now(), livemode: false, status: 'active',
  collection_method: 'charge_automatically', cancel_at_period_end: false, items: { data: [{ quantity: 1, price: price(), current_period_end: now() + 86400 }] },
  latest_invoice: { status: 'paid', currency: 'aud', amount_paid: 3000, total: 3000 }, ...overrides })
const portal = () => ({ id: 'bpc_safe', active: true, livemode: false, features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
  customer_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
  subscription_update: { enabled: false } } })

function fakeStripe() {
  const calls = [], sessions = [], customerResults = new Map(), sessionResults = new Map()
  const sdk = new Stripe('sk_test_example', { apiVersion: STRIPE_API_VERSION })
  const state = { subscriptions: [], failList: false, loseSession: false, loseCustomer: false, sessionPages: false, subscriptionPages: false,
    managedPaymentsDefault: false, failCheckoutBeforeCreate: false, price: price(), portal: portal(), calls, sessions }
  state.client = {
    webhooks: sdk.webhooks,
    prices: { retrieve: async id => { calls.push(['price', id]); return state.price } },
    subscriptions: { list: async params => { calls.push(['subscriptions', params]); if (state.failList) throw Error('Stripe offline');
      return { data: structuredClone(state.subscriptions), has_more: state.subscriptionPages } } },
    customers: { create: async (params, options) => {
      calls.push(['customer', structuredClone(params), options])
      if (!customerResults.has(options.idempotencyKey)) customerResults.set(options.idempotencyKey, { id: 'cus_owner', livemode: false })
      if (state.loseCustomer) { state.loseCustomer = false; throw Error('lost response') }
      return customerResults.get(options.idempotencyKey)
    } },
    checkout: { sessions: {
      list: async params => { calls.push(['sessions', params]); return { data: sessions, has_more: state.sessionPages } },
      retrieve: async id => { calls.push(['retrieve', id]); return sessions.find(session => session.id === id) },
      create: async (params, options) => {
        calls.push(['checkout', structuredClone(params), options])
        if ((params.managed_payments?.enabled ?? state.managedPaymentsDefault) && params.adaptive_pricing)
          throw Error('adaptive_pricing is not supported with Managed Payments; set managed_payments[enabled]=false')
        if (state.failCheckoutBeforeCreate) { state.failCheckoutBeforeCreate = false; throw Error('Checkout unavailable before creation') }
        if (!sessionResults.has(options.idempotencyKey)) {
          const session = { id: `cs_test_${sessionResults.size}`, mode: 'subscription', status: 'open', customer: params.customer,
            livemode: false, expires_at: params.expires_at, metadata: params.metadata, url: 'https://checkout.stripe.com/c/pay/example' }
          sessionResults.set(options.idempotencyKey, session); sessions.push(session)
        }
        if (state.loseSession) { state.loseSession = false; throw Error('lost response') }
        return sessionResults.get(options.idempotencyKey)
      },
    } },
    billingPortal: { configurations: { retrieve: async id => { calls.push(['portal-config', id]); return state.portal } },
      sessions: { create: async params => { calls.push(['portal', params]); return { url: 'https://billing.stripe.com/p/session/example' } } } },
  }
  return state
}

async function setup({ enabled = true, customer = false, expired = false } = {}) {
  const pg = await database(), person = await user(pg, 'owner@example.com'), db = rpcClient(pg, { user: person })
  const business = await call(db, 'create_business', { p_user: person.id, p_email: person.email, p_website: 'https://owner.example.com', p_name: 'Owner' })
  if (expired) {
    await pg.query(`update billing_accounts set trial_started_at=now()-interval '15 days',trial_ends_at=now()-interval '1 day' where business_id=$1`, [business.id])
  }
  if (enabled) await pg.exec(`update billing_settings set enabled=true,trial_start_policy='business_created'`)
  if (customer) await pg.query(`update billing_accounts set stripe_customer_id='cus_owner' where business_id=$1`, [business.id])
  const stripe = fakeStripe()
  return { pg, db, person, business, stripe, args: { db, user: person, configuration, stripe: stripe.client },
    account: () => call(db, 'billing_owner', { p_user: person.id }) }
}
const refused = (promise, code) => assert.rejects(promise, error => error.code === code)
const event = (overrides = {}) => ({ id: 'evt_event', api_version: STRIPE_API_VERSION, object: 'event', livemode: false,
  type: 'customer.subscription.updated', created: now(), data: { object: { customer: 'cus_owner', status: 'canceled' } }, ...overrides })
function signedRequest(client, payload, { timestamp, tamper = false, secret = configuration.webhookSecret } = {}) {
  const body = JSON.stringify(payload)
  const signature = client.webhooks.generateTestHeaderString({ payload: body, secret, ...(timestamp ? { timestamp } : {}) })
  return new Request('https://saygday.ai/api/stripe/webhook', { method: 'POST', headers: { 'stripe-signature': signature }, body: tamper ? `${body} ` : body })
}

test('configuration pins the SDK API, secret mode, origin and exact AUD monthly inclusive price', () => {
  assert.equal(STRIPE_API_VERSION, '2026-08-26.dahlia')
  assert.equal(createStripe(configuration).getApiField('version'), STRIPE_API_VERSION)
  assert.equal(configuration.checkoutReady, true)
  assert.ok(createStripe(configuration))
  for (const [key, value] of [['SAYGDAY_STRIPE_MODE', 'live'], ['SAYGDAY_PUBLIC_URL', 'https://saygday.ai.evil.example/path'],
    ['SAYGDAY_PUBLIC_URL', 'http://saygday.ai'], ['SAYGDAY_PUBLIC_URL', 'https://user@evil.example'], ['SAYGDAY_PUBLIC_URL', 'https://saygday.ai/?redirect=x']]) {
    assert.equal(billingConfiguration(name => name === key ? value : settings[name]).checkoutReady, false)
  }
  assert.equal(exactPrice(price(), configuration, { forCheckout: true }), true)
  for (const patch of [{ currency: 'usd' }, { unit_amount: 2999 }, { tax_behavior: 'exclusive' }, { id: 'price_elsewhere' }, { livemode: true },
    { active: false }, { billing_scheme: 'tiered' }, { transform_quantity: {} }, { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } }])
    assert.equal(exactPrice({ ...price(), ...patch }, configuration, { forCheckout: true }), false, JSON.stringify(patch))
  for (const url of ['http://checkout.stripe.com', 'https://checkout.stripe.com.evil.example/', 'https://checkout.stripe.com@evil.example/', '//checkout.stripe.com', 'javascript:alert(1)'])
    assert.throws(() => stripeUrl(url, 'checkout'))
})

test('billing states fail closed when unknown, stale, unpaid or past the paid period; local trial remains independent', () => {
  const clock = Date.now(), future = new Date(clock + 86400000).toISOString(), past = new Date(clock - 86400000).toISOString()
  const base = { enabled: true, trial_ends_at: past, subscription_status: 'active', price_valid: true, current_period_end: future, synced_at: new Date(clock).toISOString() }
  assert.equal(publicBilling(base, configuration, clock).state, 'active')
  assert.equal(publicBilling({ ...base, cancel_at_period_end: true }, configuration, clock).state, 'canceling')
  for (const patch of [{ enabled: null }, { enabled: undefined }, { synced_at: future }, { synced_at: past }, { price_valid: false },
    { current_period_end: past }, { subscription_status: 'past_due' }, { subscription_status: 'trialing' }, { subscription_status: 'unknown' }])
    assert.equal(publicBilling({ ...base, ...patch }, configuration, clock).accessAllowed, false, JSON.stringify(patch))
  assert.equal(publicBilling({ ...base, subscription_status: 'unpaid', trial_ends_at: future }, configuration, clock).accessAllowed, true)
  assert.equal(publicBilling({ enabled: false }, configuration).state, 'setup_pending')
})

test('Checkout is authenticated and ignores every client customer, price, user, trial and redirect field', async () => {
  const s = await setup()
  const request = new Request('https://evil.example/api/app', { headers: { authorization: 'Bearer token' } })
  const result = await ownerAction({ request, db: s.db, origin: 'https://evil.example', body: { action: 'billingCheckout', customerId: 'cus_attacker',
    priceId: 'price_free', user: { id: 'attacker' }, businessId: 'other', trialDays: 100, returnUrl: 'https://evil.example' }, dependencies: { billing: s.args } })
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/example')
  const params = s.stripe.calls.find(([name]) => name === 'checkout')[1]
  assert.equal(params.customer, 'cus_owner'); assert.deepEqual(params.line_items, [{ price: 'price_monthly', quantity: 1 }])
  assert.equal(params.success_url, 'https://saygday.ai/app/settings?business=owner&checkout=success')
  assert.equal(params.subscription_data.trial_end, Math.floor(Date.parse((await s.account()).trial_ends_at) / 1000))
  assert.equal(params.allow_promotion_codes, false)
  assert.equal('payment_method_types' in params, false, 'Stripe dynamically selects eligible Dashboard-enabled methods')
  assert.deepEqual(params.managed_payments, { enabled: false })
  assert.match(params.integration_identifier, /^saygday-monthly-[a-z]{8}$/)
  await refused(ownerAction({ request: new Request('https://saygday.ai/api/app'), db: s.db, body: { action: 'billingCheckout' } }), 'AUTH_REQUIRED')
})

test('no-card trial creates no Stripe customer; launch gate blocks charging and preserves existing service', async () => {
  const s = await setup({ enabled: false })
  assert.equal((await billingStatus(s.args)).state, 'setup_pending')
  assert.equal(s.stripe.calls.length, 0)
  await refused(billingCheckout(s.args), 'BILLING_NOT_ENABLED')
  assert.equal(s.stripe.calls.length, 0)
})

test('Checkout retries reuse the one session and simultaneous clicks cannot create two', async () => {
  const s = await setup()
  const results = await Promise.allSettled([billingCheckout(s.args), billingCheckout(s.args)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'BILLING_BUSY')
  await billingCheckout(s.args)
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 1)
  assert.equal(s.stripe.calls.filter(([name]) => name === 'customer').length, 1)
})

test('lost customer and Checkout responses recover durable operations without duplicate subscriptions', async () => {
  const s = await setup()
  s.stripe.loseCustomer = true
  await assert.rejects(billingCheckout(s.args), /lost response/)
  const key = (await s.account()).checkout.customer_key
  assert.ok(key)
  s.stripe.loseSession = true
  await assert.rejects(billingCheckout(s.args), /lost response/)
  assert.ok((await s.account()).checkout.params)
  await billingCheckout(s.args)
  const customerCalls = s.stripe.calls.filter(([name]) => name === 'customer')
  assert.equal(customerCalls[0][2].idempotencyKey, customerCalls[1][2].idempotencyKey)
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 1, 'lookup recovers the session even without its response')
  assert.equal((await s.account()).stripe_customer_id, 'cus_owner')
})

test('Checkout overrides Managed Payments defaults while retaining the exact direct AUD monthly offer', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.managedPaymentsDefault = true
  await billingCheckout(s.args)
  const params = s.stripe.calls.find(([name]) => name === 'checkout')[1]
  assert.deepEqual(params.managed_payments, { enabled: false })
  assert.deepEqual(params.adaptive_pricing, { enabled: false })
  assert.deepEqual(params.automatic_tax, { enabled: false })
  assert.deepEqual(params.line_items, [{ price: configuration.priceId, quantity: 1 }])
  assert.equal('payment_method_types' in params, false)
  assert.equal(s.stripe.managedPaymentsDefault, true, 'the per-session opt-out does not change account defaults')
})

test('the Checkout integration label and Managed Payments opt-out survive retries with identical idempotency parameters', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.failCheckoutBeforeCreate = true
  await assert.rejects(billingCheckout(s.args), /Checkout unavailable before creation/)
  const saved = (await s.account()).checkout
  assert.match(saved.params.integration_identifier, /^saygday-monthly-[a-z]{8}$/)
  assert.deepEqual(saved.params.managed_payments, { enabled: false })
  await billingCheckout(s.args)
  const attempts = s.stripe.calls.filter(([name]) => name === 'checkout')
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1], attempts[0], 'the integration identifier is generated once and saved before the first request')
  assert.equal(s.stripe.sessions.length, 1)
})

test('dynamic delayed-payment events cannot grant access until Stripe confirms the exact paid invoice', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.subscriptions = [subscription({ latest_invoice: { status: 'open', currency: 'aud', amount_paid: 0, total: 3000 } })]
  for (const [id, type, payment_status] of [
    ['evt_checkoutPending', 'checkout.session.completed', 'unpaid'],
    ['evt_asyncEarly', 'checkout.session.async_payment_succeeded', 'paid'],
  ]) {
    const payload = event({ id, type, data: { object: { customer: 'cus_owner', payment_status } } })
    await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) })
    assert.equal(publicBilling(await s.account(), configuration).accessAllowed, false, 'event claims cannot replace the current invoice read')
  }
  s.stripe.subscriptions = [subscription()]
  const paid = event({ id: 'evt_asyncPaid', type: 'checkout.session.async_payment_succeeded', data: { object: { customer: 'cus_owner', payment_status: 'paid' } } })
  await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, paid) })
  assert.equal(publicBilling(await s.account(), configuration).accessAllowed, true)
  s.stripe.subscriptions = [subscription({ status: 'past_due', latest_invoice: { status: 'open', currency: 'aud', amount_paid: 0, total: 3000 } })]
  const failed = event({ id: 'evt_asyncFailed', type: 'checkout.session.async_payment_failed', data: { object: { customer: 'cus_owner', payment_status: 'unpaid' } } })
  await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, failed) })
  assert.equal(publicBilling(await s.account(), configuration).accessAllowed, false)
})

test('unfinished customer creation older than Stripe idempotency retention blocks instead of making another customer', async () => {
  const s = await setup()
  await s.pg.query(`update billing_accounts set checkout=$1 where business_id=$2`, [{ customer_key: 'old-key', customer_created_at: Date.now() - 25 * 3600000 }, s.business.id])
  await refused(billingCheckout(s.args), 'BILLING_REVIEW_REQUIRED')
  assert.equal(s.stripe.calls.filter(([name]) => name === 'customer').length, 0)
})

test('a response lost over 24 hours ago still cannot charge again once its Checkout completed', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.loseSession = true
  await assert.rejects(billingCheckout(s.args), /lost response/)
  s.stripe.sessions[0].status = 'complete'
  s.stripe.subscriptions = [subscription()]
  await refused(billingCheckout({ ...s.args, now: Date.now() + 25 * 3600000 }), 'SUBSCRIPTION_EXISTS')
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 1)
  assert.equal((await s.account()).subscription_status, 'active')
})

test('last 48 hours plus Checkout minimum lifetime preserve free time, and expired trials never restart', async () => {
  const s = await setup()
  const originalEnd = Date.parse((await s.account()).trial_ends_at)
  await refused(billingCheckout({ ...s.args, now: originalEnd - 47 * 3600000 }), 'TRIAL_ENDING')
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 0)
  await billingCheckout({ ...s.args, now: originalEnd + 1000 })
  assert.equal(s.stripe.calls.find(([name]) => name === 'checkout')[1].subscription_data.trial_end, undefined)
  assert.equal(Date.parse((await s.account()).trial_ends_at), originalEnd)
})

test('every nonterminal Stripe state blocks duplicate checkout; canceled subscriptions can resubscribe', async () => {
  const s = await setup({ expired: true, customer: true })
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']) {
    s.stripe.subscriptions = [subscription({ status })]
    await refused(billingCheckout(s.args), 'SUBSCRIPTION_EXISTS')
  }
  s.stripe.subscriptions = [subscription({ status: 'canceled' })]
  await billingCheckout(s.args)
  s.stripe.sessions[0].status = 'complete'
  s.stripe.sessions[0].subscription = 'sub_plan'
  await billingCheckout(s.args)
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 2)
})

test('snapshot validates paid invoice, exact quantity, price, currency, period, mode and ownership', async () => {
  const stripe = fakeStripe(), account = { stripe_customer_id: 'cus_owner' }
  stripe.subscriptions = [subscription()]
  assert.equal((await subscriptionSnapshot(stripe.client, account, configuration)).price_valid, true)
  const cases = [ { latest_invoice: { status: 'open', amount_paid: 0, total: 3000, currency: 'aud' } }, { pause_collection: { behavior: 'void' } },
    { discounts: ['di_coupon'] }, { collection_method: 'send_invoice' }, { items: { data: [{ quantity: 2, price: price(), current_period_end: now() + 86400 }] } },
    { items: { data: [{ quantity: 1, price: { ...price(), currency: 'usd' }, current_period_end: now() + 86400 }] } }, { latest_invoice: { status: 'paid', currency: 'aud', amount_paid: 1, total: 1 } } ]
  for (const patch of cases) {
    stripe.subscriptions = [subscription(patch)]
    assert.equal((await subscriptionSnapshot(stripe.client, account, configuration)).price_valid, false, JSON.stringify(patch))
  }
  for (const patch of [{ customer: 'cus_other' }, { livemode: true }]) {
    stripe.subscriptions = [subscription(patch)]
    await refused(subscriptionSnapshot(stripe.client, account, configuration), 'BILLING_UNAVAILABLE')
  }
  stripe.subscriptions = [subscription(), subscription({ id: 'sub_duplicate' })]
  assert.equal((await subscriptionSnapshot(stripe.client, account, configuration)).price_valid, false)
  stripe.subscriptionPages = true
  await refused(subscriptionSnapshot(stripe.client, account, configuration), 'BILLING_UNAVAILABLE')
})

test('flexible portal cancel_at is a scheduled cancellation even when cancel_at_period_end is false', async () => {
  const stripe = fakeStripe(), account = { enabled: true, stripe_customer_id: 'cus_owner' }
  // Shape observed in the connected sandbox portal: paid monthly service,
  // active status, explicit cancellation timestamp, legacy boolean false.
  const periodEnd = 1793777402, clock = periodEnd - 86400
  stripe.subscriptions = [subscription({ billing_mode: { type: 'flexible' }, cancel_at_period_end: false, cancel_at: periodEnd,
    items: { data: [{ quantity: 1, price: price(), current_period_end: periodEnd }] } })]
  const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
  assert.equal(snapshot.subscription_status, 'active')
  assert.equal(snapshot.cancel_at_period_end, true)
  assert.equal(snapshot.current_period_end, new Date(periodEnd * 1000).toISOString())
  const billing = publicBilling({ ...account, ...snapshot, synced_at: new Date(clock * 1000).toISOString() }, configuration, clock * 1000)
  assert.equal(billing.state, 'canceling')
  assert.equal(billing.cancelAtPeriodEnd, true)
  assert.equal(billing.accessAllowed, true)
})

test('explicit cancellation caps paid access at the earlier date and never extends an ended period', async () => {
  const stripe = fakeStripe(), clock = now(), periodEnd = clock + 86400
  const account = { enabled: true, stripe_customer_id: 'cus_owner', synced_at: new Date(clock * 1000).toISOString() }
  for (const [cancelAt, expectedEnd, allowed] of [[clock + 3600, clock + 3600, true], [clock + 172800, periodEnd, true], [clock - 1, clock - 1, false]]) {
    stripe.subscriptions = [subscription({ cancel_at: cancelAt, cancel_at_period_end: false,
      items: { data: [{ quantity: 1, price: price(), current_period_end: periodEnd }] } })]
    const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
    assert.equal(snapshot.current_period_end, new Date(expectedEnd * 1000).toISOString())
    assert.equal(snapshot.cancel_at_period_end, true)
    assert.equal(publicBilling({ ...account, ...snapshot, synced_at: account.synced_at }, configuration, clock * 1000).accessAllowed, allowed)
  }
  stripe.subscriptions = [subscription({ cancel_at: periodEnd, items: { data: [{ quantity: 1, price: price(), current_period_end: clock - 1 }] } })]
  const expired = await subscriptionSnapshot(stripe.client, account, configuration)
  assert.equal(publicBilling({ ...account, ...expired, synced_at: account.synced_at }, configuration, clock * 1000).accessAllowed, false)
})

test('malformed cancellation dates and missing paid periods fail closed without throwing or inventing entitlement', async () => {
  const stripe = fakeStripe(), clock = now(), periodEnd = clock + 86400
  const account = { enabled: true, stripe_customer_id: 'cus_owner' }
  for (const cancelAt of [String(periodEnd), 0, -1, false, {}, [], NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
    stripe.subscriptions = [subscription({ cancel_at: cancelAt })]
    const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
    assert.equal(snapshot.price_valid, false, `cancel_at=${String(cancelAt)}`)
    assert.equal(snapshot.current_period_end, null)
    assert.equal(publicBilling({ ...account, ...snapshot, synced_at: new Date(clock * 1000).toISOString() }, configuration, clock * 1000).accessAllowed, false)
  }
  for (const paidEnd of [undefined, null, String(periodEnd), 0, Infinity, Number.MAX_SAFE_INTEGER]) {
    stripe.subscriptions = [subscription({ cancel_at: periodEnd, items: { data: [{ quantity: 1, price: price(), current_period_end: paidEnd }] } })]
    const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
    assert.equal(snapshot.current_period_end, null, 'a valid cancellation date cannot stand in for missing paid time')
    assert.equal(snapshot.price_valid, false)
  }
  for (const cancelAt of [undefined, null]) {
    stripe.subscriptions = [subscription({ cancel_at: cancelAt, cancel_at_period_end: true })]
    const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
    assert.equal(snapshot.price_valid, true)
    assert.equal(snapshot.cancel_at_period_end, true, 'classic period-end cancellation remains supported')
  }
})

test('a manually extended Stripe trial cannot extend local access or masquerade as the agreed upgrade', async () => {
  const stripe = fakeStripe(), end = now() + 86400
  const account = { enabled: true, stripe_customer_id: 'cus_owner', trial_ends_at: new Date(end * 1000).toISOString() }
  stripe.subscriptions = [subscription({ status: 'trialing', trial_end: end, latest_invoice: null })]
  assert.equal((await subscriptionSnapshot(stripe.client, account, configuration)).price_valid, true)
  stripe.subscriptions[0].trial_end = end + 86400
  const snapshot = await subscriptionSnapshot(stripe.client, account, configuration)
  assert.equal(snapshot.price_valid, false)
  assert.equal(publicBilling({ ...account, ...snapshot }, configuration, (end + 1) * 1000).accessAllowed, false)
})

test('a Checkout completing after the subscription read cannot reuse an unrelated old canceled subscription to charge twice', async () => {
  const s = await setup({ expired: true, customer: true })
  await billingCheckout(s.args)
  s.stripe.subscriptions = [subscription({ id: 'sub_old', status: 'canceled' })]
  s.stripe.sessions[0].status = 'complete'
  s.stripe.sessions[0].subscription = 'sub_new'
  await refused(billingCheckout(s.args), 'BILLING_PENDING')
  assert.equal(s.stripe.calls.filter(([name]) => name === 'checkout').length, 1)
})

test('portal cancellation remains available after expiry and price misconfiguration, uses only authenticated owner', async () => {
  const s = await setup({ expired: true, customer: true })
  const other = await user(s.pg, 'alice@example.com')
  const alien = await call(s.db, 'create_business', { p_user: other.id, p_email: other.email, p_website: 'https://alice.example.com', p_name: 'Alice' })
  await s.pg.query(`update billing_accounts set stripe_customer_id='cus_alice' where business_id=$1`, [alien.id])
  const noPrice = billingConfiguration(name => name === 'SAYGDAY_STRIPE_PRICE_ID' ? '' : settings[name])
  assert.ok(createStripe(noPrice), 'portal SDK does not depend on the checkout price')
  const result = await ownerAction({ request: new Request('https://saygday.ai/api/app', { headers: { authorization: 'Bearer token' } }), db: s.db,
    body: { action: 'billingPortal', user: { id: other.id }, p_user: other.id, businessId: alien.id, customerId: 'cus_alice', returnUrl: 'https://evil.example' },
    dependencies: { billing: { configuration: noPrice, stripe: s.stripe.client } } })
  assert.deepEqual(result, { url: 'https://billing.stripe.com/p/session/example' })
  assert.deepEqual(s.stripe.calls.find(([name]) => name === 'portal')[1], { customer: 'cus_owner', configuration: 'bpc_safe', return_url: 'https://saygday.ai/app/settings?business=owner&billing=returned' })
  s.stripe.portal.features.subscription_cancel.mode = 'immediately'
  await refused(billingPortal(s.args), 'BILLING_UNAVAILABLE')
  s.stripe.portal = portal(); s.stripe.portal.features.subscription_update.enabled = true
  await refused(billingPortal(s.args), 'BILLING_UNAVAILABLE')
})

test('real SDK rejects forged, stale and tampered raw signatures before any database or subscription work', async () => {
  const s = await setup({ customer: true })
  const count = s.db.calls.length
  for (const options of [{ secret: 'whsec_wrong' }, { timestamp: now() - 301 }, { tamper: true }])
    await refused(stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, event(), options) }), 'INVALID_SIGNATURE')
  assert.equal(s.db.calls.length, count)
  for (const payload of [event({ livemode: true }), event({ api_version: '2020-01-01' }), event({ account: 'acct_connect' })])
    await refused(stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) }), 'WEBHOOK_CONFIGURATION')
})

test('signed event metadata cannot take ownership of an unknown customer', async () => {
  const s = await setup({ customer: true })
  const payload = event({ data: { object: { customer: 'cus_attacker', metadata: { saygday_business_id: s.business.id } } } })
  assert.deepEqual(await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) }), { received: true, ignored: true })
  assert.equal(s.stripe.calls.length, 0)
  assert.equal((await s.account()).subscription_status, 'none')
})

test('duplicate and out-of-order webhooks commit current Stripe state, never an old cancellation snapshot', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.subscriptions = [subscription({ id: 'sub_old', status: 'canceled', created: now() - 100 }), subscription({ id: 'sub_new' })]
  const payload = event({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_owner', status: 'canceled' } } })
  assert.equal((await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) })).duplicate, false)
  assert.equal((await s.account()).stripe_subscription_id, 'sub_new')
  const count = s.stripe.calls.length
  assert.equal((await stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) })).duplicate, true)
  assert.equal(s.stripe.calls.length, count, 'duplicate receipt needs no provider work')
  assert.equal((await billingStatus(s.args)).state, 'active')
})

test('parallel webhook workers cannot overwrite each other; retry after lease contention converges', async () => {
  const s = await setup({ customer: true }), account = await s.account()
  s.stripe.subscriptions = [subscription()]
  const locked = await call(s.db, 'billing_acquire', { p_business: s.business.id })
  const payload = event()
  await refused(stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, payload) }), 'BILLING_BUSY')
  assert.equal(await call(s.db, 'billing_event_seen', { p_event_id: payload.id }), false)
  await call(s.db, 'billing_release', { p_business: s.business.id, p_lease: locked.lease })
  await reconcileAccount({ ...s.args, account, event: payload })
  assert.equal((await s.account()).subscription_status, 'active')
})

test('failed webhook stays retryable; missing webhook is repaired by status and outage never extends access', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.failList = true
  await assert.rejects(stripeWebhook({ ...s.args, request: signedRequest(s.stripe.client, event()) }), /Stripe offline/)
  assert.equal(await call(s.db, 'billing_event_seen', { p_event_id: 'evt_event' }), false)
  assert.equal((await billingStatus(s.args)).accessAllowed, false)
  s.stripe.failList = false; s.stripe.subscriptions = [subscription()]
  assert.equal((await billingStatus(s.args)).accessAllowed, true)
  s.stripe.failList = true
  assert.equal((await billingStatus(s.args)).accessAllowed, true, 'a recently verified paid window survives a transient outage')
  await s.pg.query(`update billing_accounts set synced_at=now()-interval '25 hours' where business_id=$1`, [s.business.id])
  assert.equal((await billingStatus(s.args)).accessAllowed, false)
})

test('bounded background reconciliation repairs missed events without browser visits', async () => {
  const s = await setup({ expired: true, customer: true })
  s.stripe.subscriptions = [subscription()]
  assert.deepEqual(await reconcileBillingBatch(s.args), { processed: 1, failed: 0 })
  assert.equal((await s.account()).subscription_status, 'active')
  assert.deepEqual(await reconcileBillingBatch(s.args), { processed: 0, failed: 0 })
})

