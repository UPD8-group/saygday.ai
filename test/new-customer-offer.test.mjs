import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { database, user, rpcClient } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { billingConfiguration, accountBillingConfiguration, publicBilling, exactPrice, billingCheckout } from '../netlify/functions/_lib/billing.mjs'
import { CURRENT_OFFERS } from '../site/published-copy.mjs'

const oldPriceId = 'price_1UOA0sR8qEoKoynxWAoOrDeA'
const values = { SAYGDAY_STRIPE_SECRET_KEY: 'sk_live_example', SAYGDAY_STRIPE_MODE: 'live', SAYGDAY_STRIPE_PRICE_ID: oldPriceId,
  SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test', SAYGDAY_STRIPE_WEBHOOK_SECRET: 'whsec_example', SAYGDAY_PUBLIC_URL: 'https://saygday.ai' }
const configuration = billingConfiguration(name => values[name])
const price = amount => ({ id: amount === 5900 ? CURRENT_OFFERS.selfManagedPriceId : oldPriceId, active: true, livemode: true,
  currency: 'aud', unit_amount: amount, tax_behavior: 'inclusive', type: 'recurring', billing_scheme: 'per_unit',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } })
async function create(pg, email, website) {
  const person = await user(pg, email), db = rpcClient(pg, { user: person })
  const business = await call(db, 'create_business', { p_user: person.id, p_email: person.email, p_website: website, p_name: email })
  return { person, db, business, account: () => call(db, 'billing_owner', { p_user: person.id }) }
}

test('new A$59 offer does not mutate any existing billing row, agreement or trial date', async () => {
  const pg = await database({ cardRequired: false })
  await pg.exec("update billing_settings set enabled=true,trial_start_policy='business_created'")
  const old = await create(pg, 'existing@example.com', 'https://existing.example.com')
  const agreed = await create(pg, 'agreed@example.com', 'https://agreed.example.com')
  await pg.query("update billing_accounts set price_override_id='price_agreed',price_override_amount=6000 where business_id=$1", [agreed.business.id])
  const before = (await pg.query('select * from billing_accounts order by business_id')).rows
  const sql = await readFile(new URL('../supabase/new-customer-offer.sql', import.meta.url), 'utf8')
  await pg.exec(sql)
  assert.deepEqual((await pg.query('select * from billing_accounts order by business_id')).rows, before)
  const fresh = await create(pg, 'new@example.com', 'https://new.example.com')
  const account = await fresh.account()
  assert.equal(account.price_override_id, CURRENT_OFFERS.selfManagedPriceId)
  assert.equal(account.price_override_amount, 5900)
  assert.equal(publicBilling(account, configuration).monthlyAmount, 5900)
  assert.equal(publicBilling(await old.account(), configuration).monthlyAmount, 3000)
  assert.equal(publicBilling(await agreed.account(), configuration).monthlyAmount, 6000)
  const freshConfig = accountBillingConfiguration(account, configuration)
  assert.equal(exactPrice(price(5900), freshConfig, { forCheckout: true }), true)
  assert.equal(exactPrice(price(3000), freshConfig, { forCheckout: true }), false)
  assert.equal(exactPrice(price(3000), configuration, { forCheckout: true }), true)
  // Idempotent deployment and billing_ensure's upsert must not overwrite old prices.
  await pg.exec(sql)
  await old.account()
  await agreed.account()
  const existing = (await pg.query('select * from billing_accounts where business_id=any($1::uuid[]) order by business_id', [[old.business.id, agreed.business.id]])).rows
  assert.deepEqual(existing, before)
})

test('the existing Checkout implementation uses the new pinned offer without a live charge', async () => {
  const pg = await database({ cardRequired: false })
  await pg.exec("update billing_settings set enabled=true,trial_start_policy='business_created'")
  await pg.exec(await readFile(new URL('../supabase/new-customer-offer.sql', import.meta.url), 'utf8'))
  const fresh = await create(pg, 'checkout@example.com', 'https://checkout.example.com')
  await pg.query("update billing_accounts set stripe_customer_id='cus_offer' where business_id=$1", [fresh.business.id])
  let checkoutParams
  const stripe = {
    prices: { retrieve: async id => { assert.equal(id, CURRENT_OFFERS.selfManagedPriceId); return price(5900) } },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
    billingPortal: { configurations: { retrieve: async () => ({ active: true, livemode: true,
      features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false } } }) } },
    checkout: { sessions: { create: async params => {
      checkoutParams = params
      return { id: 'cs_live_offer', mode: 'subscription', status: 'open', customer: 'cus_offer', livemode: true,
        metadata: params.metadata, ui_mode: 'elements', expires_at: params.expires_at, client_secret: 'cs_live_offer_secret_testonly' }
    } } },
  }
  const result = await billingCheckout({ db: fresh.db, user: fresh.person, configuration, stripe })
  assert.equal(result.monthlyAmount, 5900)
  assert.equal(checkoutParams.line_items[0].price, CURRENT_OFFERS.selfManagedPriceId)
  assert.equal(checkoutParams.line_items[0].quantity, 1)
  assert.equal(checkoutParams.mode, 'subscription')
})
