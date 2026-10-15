import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { database, user, rpcClient } from './helpers/database.mjs'
import { call } from '../netlify/functions/_lib/runtime.mjs'
import { billingConfiguration, accountBillingConfiguration, publicBilling, exactPrice, billingCheckout } from '../netlify/functions/_lib/billing.mjs'
import { CURRENT_OFFERS } from '../site/published-copy.mjs'

const defaultPrice = 'price_1UOA0sR8qEoKoynxWAoOrDeA'
const previousOffer = 'price_1UQwkRR8qEoKoynxsgmnPqqX'
const values = { SAYGDAY_STRIPE_SECRET_KEY: 'sk_live_example', SAYGDAY_STRIPE_MODE: 'live', SAYGDAY_STRIPE_PRICE_ID: defaultPrice,
  SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test', SAYGDAY_STRIPE_WEBHOOK_SECRET: 'whsec_example', SAYGDAY_PUBLIC_URL: 'https://saygday.ai' }
const configuration = billingConfiguration(name => values[name])
const price = (id, amount) => ({ id, active: true, livemode: true, currency: 'aud', unit_amount: amount,
  tax_behavior: 'inclusive', type: 'recurring', billing_scheme: 'per_unit',
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } })
const migration = () => readFile(new URL('../supabase/new-customer-offer.sql', import.meta.url), 'utf8')
async function create(pg, email, website) {
  const person = await user(pg, email), db = rpcClient(pg, { user: person })
  const business = await call(db, 'create_business', { p_user: person.id, p_email: person.email, p_website: website, p_name: email })
  return { person, db, business, account: () => call(db, 'billing_owner', { p_user: person.id }) }
}

test('A$30 future defaults preserve ALL existing rows including A$59, A$60 and A$75 agreements', async () => {
  const pg = await database({ cardRequired: false })
  await pg.exec("update billing_settings set enabled=true,trial_start_policy='business_created'")
  const legacy = await create(pg, 'legacy@example.com', 'https://legacy.example.com')
  const agreements = [[previousOffer,5900],['price_agreed',6000],['price_1UQwoQR8qEoKoynxsA2ojHYu',7500]]
  const saved = []
  for (let index = 0; index < agreements.length; index++) {
    const item = await create(pg, `existing${index}@example.com`, `https://existing${index}.example.com`)
    const [id, amount] = agreements[index]
    await pg.query('update billing_accounts set price_override_id=$1,price_override_amount=$2 where business_id=$3', [id, amount, item.business.id])
    saved.push(item)
  }
  const before = (await pg.query('select * from billing_accounts order by business_id')).rows
  await pg.exec(await migration())
  assert.deepEqual((await pg.query('select * from billing_accounts order by business_id')).rows, before)
  const fresh = await create(pg, 'new@example.com', 'https://new.example.com')
  const account = await fresh.account()
  assert.equal(account.price_override_id, defaultPrice)
  assert.equal(account.price_override_amount, 3000)
  assert.equal(publicBilling(account, configuration).monthlyAmount, 3000)
  assert.equal(publicBilling(await legacy.account(), configuration).monthlyAmount, 3000)
  for (let index = 0; index < saved.length; index++) {
    const existing = await saved[index].account()
    const [id, amount] = agreements[index]
    assert.equal(publicBilling(existing, configuration).monthlyAmount, amount)
    assert.equal(exactPrice(price(id, amount), accountBillingConfiguration(existing, configuration), { forCheckout: true }), true)
  }
  const freshConfig = accountBillingConfiguration(account, configuration)
  assert.equal(exactPrice(price(defaultPrice, 3000), freshConfig, { forCheckout: true }), true)
  assert.equal(exactPrice(price(previousOffer, 5900), freshConfig, { forCheckout: true }), false)
  assert.equal(exactPrice(price(defaultPrice, 5900), freshConfig, { forCheckout: true }), false)
  await pg.exec(await migration())
  const ids = [legacy, ...saved].map(item => item.business.id)
  assert.deepEqual((await pg.query('select * from billing_accounts where business_id=any($1::uuid[]) order by business_id', [ids])).rows, before)
})

test('new Checkout uses the verified A$30 price; it never starts a studio subscription or live charge', async () => {
  const pg = await database({ cardRequired: false })
  await pg.exec("update billing_settings set enabled=true,trial_start_policy='business_created'")
  await pg.exec(await migration())
  const fresh = await create(pg, 'checkout@example.com', 'https://checkout.example.com')
  await pg.query("update billing_accounts set stripe_customer_id='cus_offer' where business_id=$1", [fresh.business.id])
  let params
  const stripe = {
    prices: { retrieve: async id => { assert.equal(id, CURRENT_OFFERS.selfManagedPriceId); return price(defaultPrice, 3000) } },
    subscriptions: { list: async () => ({ data: [], has_more: false }) },
    billingPortal: { configurations: { retrieve: async () => ({ active: true, livemode: true,
      features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true },
        subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false } } }) } },
    checkout: { sessions: { create: async value => {
      params = value
      return { id: 'cs_live_offer', mode: 'subscription', status: 'open', customer: 'cus_offer', livemode: true,
        metadata: value.metadata, ui_mode: 'elements', expires_at: value.expires_at, client_secret: 'cs_live_offer_secret_testonly' }
    } } },
  }
  const result = await billingCheckout({ db: fresh.db, user: fresh.person, configuration, stripe })
  assert.equal(result.monthlyAmount, 3000)
  assert.deepEqual(params.line_items, [{ price: defaultPrice, quantity: 1 }])
  assert.equal(params.mode, 'subscription')
})
