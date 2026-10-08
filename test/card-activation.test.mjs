import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import Stripe from 'stripe'
import { database, rpcClient, user } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { billingCheckout, billingStatus, stripeWebhook, STRIPE_API_VERSION } from '../netlify/functions/_lib/billing.mjs'

const configuration = { key: 'sk_test_example', live: false, keyReady: true, stripeReady: true, checkoutReady: true,
  publishableKey: 'pk_test_example',
  portalReady: true, webhookReady: true, priceId: 'price_monthly', portalConfigurationId: 'bpc_safe',
  webhookSecret: 'whsec_example', publicUrl: 'https://saygday.ai' }
const price = { id: 'price_monthly', active: true, livemode: false, currency: 'aud', unit_amount: 3000, tax_behavior: 'inclusive',
  type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }

async function setup() {
  const pg = await database(), person = await user(pg), db = rpcClient(pg)
  await pg.exec('update billing_settings set enabled=true')
  const business = await call(db, 'create_business', { p_user: person.id, p_email: person.email, p_website: 'https://card.example.com' })
  const sdk = new Stripe(configuration.key, { apiVersion: STRIPE_API_VERSION })
  const state = { subscriptions: [], sessions: [], calls: [] }
  const stripe = {
    webhooks: sdk.webhooks,
    prices: { retrieve: async () => price },
    customers: { create: async () => ({ id: 'cus_card', livemode: false }) },
    subscriptions: { list: async () => ({ data: state.subscriptions, has_more: false }) },
    billingPortal: { configurations: { retrieve: async () => ({ active: true, livemode: false, features: {
      payment_method_update: { enabled: true }, invoice_history: { enabled: true }, customer_update: { enabled: false },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false } } }) } },
    checkout: { sessions: {
      create: async (params, options) => { state.calls.push({ params, options });
        const session = { id: 'cs_card', mode: 'subscription', customer: 'cus_card', status: 'open', livemode: false,
          expires_at: params.expires_at, metadata: params.metadata, ui_mode: params.ui_mode, client_secret: 'cs_card_secret_example' };
        state.sessions.push(session); return session },
      retrieve: async () => state.sessions[0], list: async () => ({ data: state.sessions, has_more: false }),
    } },
  }
  const args = { db, user: person, business: business.id, stripe, configuration }
  const account = () => call(db, 'billing_owner', { p_user: person.id, p_business: business.id })
  const verify = () => call(db, 'mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  const deliver = async (id = 'evt_card', options = {}) => {
    const body = JSON.stringify({ id, object: 'event', api_version: STRIPE_API_VERSION, type: 'checkout.session.completed',
      livemode: false, data: { object: { customer: 'cus_card' } } })
    const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: configuration.webhookSecret })
    return stripeWebhook({ ...args, request: new Request('https://saygday.ai/api/stripe/webhook', {
      method: 'POST', headers: { 'stripe-signature': signature }, body: options.tamper ? body + ' ' : body }) })
  }
  const trial = () => {
    const start = Math.floor(Date.now() / 1000)
    return { id: 'sub_card', customer: 'cus_card', livemode: false, created: start, status: 'trialing',
      collection_method: 'charge_automatically', default_payment_method: 'pm_card', trial_start: start, trial_end: start + 14 * 86400,
      metadata: state.calls[0].params.subscription_data.metadata,
      items: { data: [{ quantity: 1, price, current_period_end: start + 14 * 86400 }] } }
  }
  return { pg, db, business, args, state, account, verify, deliver, trial }
}

test('new card activation requires verification and a confirmed payment method before any public access', async () => {
  const s = await setup()
  assert.equal((await s.account()).card_required, true)
  assert.equal((await billingStatus(s.args)).checkoutAvailable, false)
  await assert.rejects(billingCheckout(s.args), e => e.code === 'BILLING_NOT_ENABLED')
  await s.verify()
  assert.equal((await s.account()).trial_started_at, null, 'website proof alone cannot start a card-backed trial')
  assert.equal(await call(s.db, 'widget', { p_slug: s.business.slug }), null)
  assert.equal(await call(s.db, 'chat_website', { p_slug: s.business.slug }), null)
  assert.equal(await call(s.db, 'button_seen', { p_slug: s.business.slug }), false)
  await assert.rejects(call(s.db, 'ask_team', { p_slug: s.business.slug, p_question: 'Hello' }), e => e.code === 'NOT_FOUND')
  const ready = await billingStatus(s.args)
  assert.equal(ready.state, 'card_required'); assert.equal(ready.checkoutAvailable, true); assert.equal(ready.accessAllowed, false)
  await billingCheckout(s.args)
  const params = s.state.calls[0].params
  assert.equal(params.payment_method_collection, 'always')
  assert.equal(params.subscription_data.trial_period_days, 14)
  assert.equal(params.subscription_data.trial_end, undefined)
  assert.equal(params.subscription_data.trial_settings.end_behavior.missing_payment_method, 'cancel')
  assert.equal(params.line_items[0].price, 'price_monthly')
  assert.equal((await s.account()).trial_started_at, null, 'opening or abandoning Checkout grants nothing')
  await billingCheckout(s.args)
  assert.equal(s.state.calls.length, 1, 'repeat activation reuses Checkout')
  await s.deliver('evt_nosub')
  assert.equal((await s.account()).trial_started_at, null, 'a completion notification without provider state grants nothing')
  for (const patch of [{ default_payment_method: null }, { metadata: {} }, { trial_end: s.trial().trial_end + 86400 },
    { items: { data: [{ quantity: 2, price, current_period_end: s.trial().trial_end }] } }]) {
    s.state.subscriptions = [{ ...s.trial(), ...patch }]
    await billingStatus(s.args)
    assert.equal((await s.account()).trial_started_at, null, JSON.stringify(patch))
  }
  const trial = s.trial()
  s.state.subscriptions = [trial]
  await assert.rejects(s.deliver('evt_tampered', { tamper: true }), e => e.code === 'INVALID_SIGNATURE')
  assert.equal((await s.account()).trial_started_at, null)
  await s.deliver()
  const saved = await s.account()
  assert.equal(Date.parse(saved.trial_started_at), trial.trial_start * 1000)
  assert.equal(Date.parse(saved.trial_ends_at) - Date.parse(saved.trial_started_at), 14 * 86400000)
  assert.equal(saved.access_allowed, true)
  assert.ok(await call(s.db, 'widget', { p_slug: s.business.slug }))
  assert.equal((await billingStatus(s.args)).subscriptionScheduled, true)
  assert.equal((await s.deliver()).duplicate, true)
  await assert.rejects(s.pg.query("update billing_accounts set trial_ends_at=trial_ends_at+interval '1 day' where business_id=$1", [s.business.id]), /BILLING_TRIAL_IMMUTABLE/)
  s.state.subscriptions[0] = { ...trial, status: 'canceled' }
  await s.deliver('evt_cancel')
  assert.equal((await s.account()).trial_ends_at, saved.trial_ends_at)
  await billingStatus(s.args)
  assert.equal((await s.account()).trial_started_at, saved.trial_started_at, 'cancellation cannot reset trial dates')
  await s.pg.exec(await readFile(new URL('../supabase/billing-card-activation.sql', import.meta.url), 'utf8'))
  assert.equal((await s.account()).card_required, true, 'reapplying does not grandfather new card-backed trials')
})

test('card rollout preserves legacy trial dates and grants no fresh trial on migration', async () => {
  const pg = await database({ cardRequired: false }), person = await user(pg), db = rpcClient(pg)
  await pg.exec('update billing_settings set enabled=true')
  const business = await call(db, 'create_business', { p_user: person.id, p_email: person.email, p_website: 'https://legacy.example.com' })
  await call(db, 'mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  const before = await call(db, 'billing_owner', { p_user: person.id })
  await pg.exec(await readFile(new URL('../supabase/billing-card-activation.sql', import.meta.url), 'utf8'))
  const after = await call(db, 'billing_owner', { p_user: person.id })
  assert.equal(after.card_required, false)
  assert.equal(after.trial_started_at, before.trial_started_at)
  assert.equal(after.trial_ends_at, before.trial_ends_at)
  assert.equal(after.access_allowed, true)
})
