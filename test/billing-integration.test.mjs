import test from 'node:test'
import assert from 'node:assert/strict'
import { database, rpcClient, user } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { billingConfiguration, publicBilling } from '../netlify/functions/_lib/billing.mjs'
import { stageOf, summarise } from '../src/admin/metrics.mjs'

async function setup() {
  const pg = await database({ cardRequired: false }), owner = await user(pg), stranger = await user(pg)
  const db = rpcClient(pg, { user: owner })
  const add = (who, website) => call(db, 'create_business', { p_user: who.id, p_email: who.email, p_website: website })
  const a = await add(owner, 'https://first.example.com'), b = await add(owner, 'https://second.example.com')
  const alien = await add(stranger, 'https://alien.example.com')
  return { pg, owner, db, a, b, alien }
}

test('billing ownership names one website and rejects missing or foreign selections', async () => {
  const s = await setup()
  const read = business => call(s.db, 'billing_owner', { p_user: s.owner.id, p_business: business })
  assert.equal((await read(s.a.id)).business_id, s.a.id)
  assert.equal((await read(s.b.id)).business_id, s.b.id)
  await assert.rejects(read(null), error => error.code === 'CHOOSE_BUSINESS')
  await assert.rejects(read(s.alien.id), error => error.code === 'NO_BUSINESS')
  const request = new Request('https://saygday.ai/api/app', { headers: { authorization: 'Bearer valid' } })
  const config = billingConfiguration(name => ({
    SAYGDAY_STRIPE_SECRET_KEY: 'rk_test_example', SAYGDAY_STRIPE_MODE: 'test',
    SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_safe', SAYGDAY_PUBLIC_URL: 'https://saygday.ai',
  })[name])
  const portals = []
  const stripe = { billingPortal: {
    configurations: { retrieve: async () => ({ active: true, livemode: false, features: {
      payment_method_update: { enabled: true }, invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' },
    } }) },
    sessions: { create: async params => { portals.push(params); return { url: 'https://billing.stripe.com/p/session/example' } } },
  } }
  await s.pg.query("update billing_accounts set stripe_customer_id='cus_second' where business_id=$1", [s.b.id])
  const act = body => ownerAction({ request, db: s.db, body, origin: 'https://saygday.ai', dependencies: { billing: { configuration: config, stripe } } })
  await act({ action: 'billingPortal', business: s.b.id })
  assert.equal(portals[0].customer, 'cus_second')
  assert.equal(new URL(portals[0].return_url).searchParams.get('business'), s.b.slug)
  await assert.rejects(act({ action: 'billingPortal', business: s.alien.id }), error => error.code === 'NO_BUSINESS')
  assert.equal(portals.length, 1, 'foreign billing cannot reach Stripe')
  assert.equal((await act({ action: 'me', business: s.b.id })).business.id, s.b.id)
})

test('all latest public entry points enforce billing without losing colours or activity counters', async () => {
  const s = await setup()
  const ownerArgs = { p_user: s.owner.id, p_business: s.a.id }
  await call(s.db, 'mark_website_verified', { p_slug: s.a.slug, p_website: s.a.website, p_method: 'button' })
  await call(s.db, 'update_business', { ...ownerArgs, p_button_colour: '#cc3366' })
  const faq = await call(s.db, 'save_faq', { ...ownerArgs, p_id: null, p_question: 'Where do I park?', p_answer: 'In the car park.' })
  await s.pg.query("update billing_accounts set trial_started_at=now()-interval '15 days', trial_ends_at=now()-interval '1 day' where business_id=$1", [s.a.id])
  await s.pg.exec("update billing_settings set enabled=true")
  assert.equal(await call(s.db, 'widget', { p_slug: s.a.slug }), null)
  assert.equal(await call(s.db, 'chat_website', { p_slug: s.a.slug }), null)
  assert.equal(await call(s.db, 'button_seen', { p_slug: s.a.slug }), false)
  assert.equal(await call(s.db, 'faq_viewed', { p_slug: s.a.slug, p_faq: faq.id }), false)
  await assert.rejects(call(s.db, 'ask_team', { p_slug: s.a.slug, p_question: 'Can you help?', p_email: null }))
  await assert.rejects(call(s.db, 'start_scan', { ...ownerArgs, p_website: s.a.website }), error => error.code === 'BILLING_REQUIRED')
  await s.pg.query("update billing_accounts set stripe_customer_id='cus_paid', subscription_status='active', price_valid=true, synced_at=now(), current_period_end=now()+interval '30 days' where business_id=$1", [s.a.id])
  assert.equal((await call(s.db, 'widget', { p_slug: s.a.slug })).buttonColour, '#cc3366')
  assert.equal(await call(s.db, 'faq_viewed', { p_slug: s.a.slug, p_faq: faq.id }), true)
  assert.equal(await call(s.db, 'button_seen', { p_slug: s.a.slug }), true)
  const activity = (await s.pg.query('select answers_read,button_hours from business_activity where business_id=$1',[s.a.id])).rows[0]
  assert.deepEqual(activity, { answers_read: 1, button_hours: 1 })
  const plans = () => s.pg.query('select plan from businesses where id=$1', [s.a.id])
  assert.equal((await plans()).rows[0].plan,'paying')
  await s.pg.query("update billing_accounts set cancel_at_period_end=true, synced_at=now() where business_id=$1",[s.a.id])
  assert.equal((await plans()).rows[0].plan,'paying')
  await s.pg.query("update billing_accounts set subscription_status='canceled', synced_at=now() where business_id=$1",[s.a.id])
  assert.equal((await plans()).rows[0].plan,'cancelled')
  assert.equal(await call(s.db, 'billing_access', { p_business: s.a.id }), false)
  assert.equal((await s.pg.query('select count(*)::integer as n from plan_changes where business_id=$1',[s.a.id])).rows[0].n, 2)
})

test('internal businesses keep access and never offer a purchase or inflate revenue', async () => {
  const s = await setup()
  await s.pg.exec("update billing_settings set enabled=true")
  await call(s.db, 'admin_set_plan', { p_business: s.a.id, p_plan: 'internal' })
  const account = await call(s.db, 'billing_owner', { p_user: s.owner.id, p_business: s.a.id })
  assert.equal(await call(s.db, 'billing_access', { p_business: s.a.id }), true)
  assert.equal(publicBilling(account).state, 'internal')
  assert.equal(publicBilling(account).checkoutAvailable, false)
  assert.equal(stageOf({ plan: 'internal', billing: { enabled: true } }).key, 'internal')
})

test('admin uses verification trial dates and counts only fresh paid subscriptions', () => {
  const now = Date.parse('2026-10-08T00:00:00Z')
  const base = { id:'a', ownerId:'u', plan:'paying', createdAt:'2026-09-01T00:00:00Z', billing: { enabled:true,
    trialStartedAt:'2026-10-06T00:00:00Z', trialEndsAt:'2026-10-20T00:00:00Z', hasCustomer:true } }
  assert.equal(stageOf(base,now).day,3,'stored paying label alone cannot invent a paid customer')
  assert.equal(stageOf({...base,billing:{enabled:true}},now).key,'not_started')
  const paid = {...base,billing:{...base.billing,subscriptionStatus:'active',priceValid:true,
    syncedAt:'2026-10-07T23:00:00Z',currentPeriodEnd:'2026-11-01T00:00:00Z'}}
  assert.equal(stageOf(paid,now).key,'paying')
  assert.notEqual(stageOf({...paid,billing:{...paid.billing,syncedAt:'2026-10-06T00:00:00Z'}},now).key,'paying')
  const totals=summarise({businesses:[paid,{...paid,id:'internal',plan:'internal'},base]},now).totals
  assert.equal(totals.paying,1)
  assert.equal(totals.mrr,30)
})

