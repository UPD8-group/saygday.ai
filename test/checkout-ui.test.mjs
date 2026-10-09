import assert from 'node:assert/strict'
import test from 'node:test'
import { checkoutBootstrap, checkoutDate, checkoutDay, checkoutView } from '../src/app/checkout-view.mjs'
import { requestCheckoutBootstrap } from '../src/app/checkout-stripe.mjs'

const now = Date.parse('2026-10-08T10:50:00Z')
const bootstrap = {
  businessId: 'owned-business',
  clientSecret: 'cs_live_fixture_secret_opaque%2Fwith%2Bescapes',
  publishableKey: 'pk_live_fixture',
  expiresAt: Math.floor(now / 1000) + 86400,
}
const checkout = checkoutBootstrap(bootstrap, 'owned-business', now)
function session() {
  return {
    id: 'cs_live_fixture', livemode: true,
    status: { type: 'open' }, currency: 'aud', minorUnitsAmountDivisor: 100,
    total: { total: { amount: 'A$0.00', minorUnitsAmount: 0 } },
    recurring: { interval: 'month', intervalCount: 1, dueNext: { total: { amount: 'A$40.00', minorUnitsAmount: 4000 } }, trial: { trialEnd: 1792660037, trialPeriodDays: null } },
  }
}

test('checkout bootstrap binds a current opaque Stripe secret to the selected business and matching key mode', () => {
  assert.equal(checkout.sessionId, 'cs_live_fixture')
  assert.equal(checkout.livemode, true)
  assert.equal(checkout.clientSecret, bootstrap.clientSecret, 'opaque escaping is preserved exactly')
  assert.equal(checkoutBootstrap({ ...bootstrap, clientSecret: 'cs_test_fixture_secret_opaque', publishableKey: 'pk_test_fixture' }, 'owned-business', now).livemode, false)
  for (const changed of [
    { businessId: 'another-business' }, { publishableKey: 'pk_test_fixture' },
    { clientSecret: 'https://checkout.stripe.com/session' }, { clientSecret: 'cs_live_fixture_secret_' },
    { clientSecret: 'cs_live_fixture_secret_has whitespace' }, { publishableKey: 'sk_live_secret' },
    { expiresAt: Math.floor(now / 1000) }, { expiresAt: String(bootstrap.expiresAt) },
  ]) assert.throws(() => checkoutBootstrap({ ...bootstrap, ...changed }, 'owned-business', now), /could not open/)
})

test('an existing trial displays the exact Stripe billing date without a rounded remaining-day countdown', () => {
  const view = checkoutView(session(), checkout, now)
  assert.equal(view.title, 'Your billing starts on 22 October 2026')
  assert.equal(view.dueToday, 'A$0.00')
  assert.equal(view.trial, true)
  assert.doesNotMatch(view.title, /13 days|14 days|hours/)
  const later = checkoutView(session(), checkout, now + 23 * 3600000)
  assert.equal(later.title, view.title, 'elapsed time does not shorten the date label')
})

test('new 14-day trials use Stripe trialEnd, and never add fourteen days to a browser clock', () => {
  const s = session()
  s.recurring.trial = { trialEnd: Math.floor(Date.parse('2026-10-22T13:15:00Z') / 1000), trialPeriodDays: 14 }
  assert.equal(checkoutView(s, checkout, now).date, '23 October 2026', 'Sydney date comes from Stripe, not from today or UTC')
  assert.equal(checkoutDate(Math.floor(Date.parse('2026-10-22T12:59:59Z') / 1000)), '22 October 2026')
  assert.equal(checkoutDate(Math.floor(Date.parse('2026-10-22T13:00:00Z') / 1000)), '23 October 2026')
})

test('expired trials pay immediately and cannot accidentally promise a free period', () => {
  const s = session()
  s.recurring.trial = null
  s.total.total = { amount: 'A$40.00', minorUnitsAmount: 4000 }
  const view = checkoutView(s, checkout, now)
  assert.equal(view.trial, false)
  assert.equal(view.dueToday, 'A$40.00')
  assert.equal(view.button, 'Subscribe for A$40/month')
  assert.equal(view.date, '')
  assert.doesNotMatch(view.title, /free|billing starts on/)
})

test('Stripe amounts are read for its confirmation requirement and returned for visible display', () => {
  const s = session()
  let reads = 0
  Object.defineProperty(s.total.total, 'amount', { get() { reads++; return 'A$0.00' } })
  const view = checkoutView(s, checkout, now)
  assert.ok(reads > 0)
  assert.equal(view.dueToday, 'A$0.00')
})

test('wrong sessions, wrong prices, currency changes, missing totals and invalid trial dates fail closed', () => {
  const changes = [
    s => { s.id = 'cs_live_someoneelse' }, s => { s.livemode = false },
    s => { s.currency = 'usd' }, s => { s.minorUnitsAmountDivisor = 1 },
    s => { s.recurring.interval = 'year' }, s => { s.recurring.intervalCount = 2 },
    s => { s.recurring.dueNext.total.minorUnitsAmount = 6000 },
    s => { s.recurring.dueNext.total.minorUnitsAmount = 3000 },
    s => { s.total.total.minorUnitsAmount = 4000 },
    s => { s.total.total.minorUnitsAmount = '0' },
    s => { s.total.total.amount = null }, s => { delete s.total },
    s => { s.recurring.trial.trialEnd = Math.floor(now / 1000) },
    s => { s.recurring.trial.trialEnd = '1792660037' },
    s => { s.recurring.trial = null }, s => { s.status.type = 'unknown' },
  ]
  for (const change of changes) { const s = session(); change(s); assert.throws(() => checkoutView(s, checkout, now)) }
  assert.throws(() => checkoutView(null, checkout, now))
  assert.throws(() => checkoutDate(NaN))
})

test('expiry and completed Checkout do not fabricate a payment or subscription entitlement', () => {
  assert.throws(() => checkoutView(session(), checkout, checkout.expiresAt * 1000), /expired/)
  const s = session()
  s.status.type = 'expired'
  assert.throws(() => checkoutView(s, checkout, now), /expired/)
  s.status = { type: 'complete', paymentStatus: 'no_payment_required' }
  assert.deepEqual(checkoutView(s, checkout, now), { complete: true }, 'completion only tells the page to return for server reconciliation')
})

test('calendar boundary detection follows Sydney midnight, including the daylight saving boundary', () => {
  assert.notEqual(checkoutDay(Date.parse('2026-10-08T12:59:59Z')), checkoutDay(Date.parse('2026-10-08T13:00:00Z')))
  assert.equal(checkoutDay(Date.parse('2026-10-03T14:30:00Z')), checkoutDay(Date.parse('2026-10-03T16:30:00Z')), 'the skipped daylight-saving hour stays on the same date')
})

test('StrictMode replays share only the in-flight checkout for the same request and business', async () => {
  const calls = []
  const waiting = new Map()
  const request = (action, params) => {
    calls.push([action, params.business])
    return new Promise(resolve => waiting.set(params.business, resolve))
  }
  const first = requestCheckoutBootstrap(request, 'one')
  const replay = requestCheckoutBootstrap(request, 'one')
  const another = requestCheckoutBootstrap(request, 'two')
  assert.equal(first, replay)
  assert.notEqual(first, another)
  await Promise.resolve()
  assert.deepEqual(calls, [['billingCheckout', 'one'], ['billingCheckout', 'two']])
  waiting.get('one')({ clientSecret: 'only-in-flight' })
  waiting.get('two')({ clientSecret: 'different-business' })
  assert.deepEqual(await first, { clientSecret: 'only-in-flight' })
  assert.deepEqual(await another, { clientSecret: 'different-business' })
  const fresh = requestCheckoutBootstrap(request, 'one')
  assert.notEqual(fresh, first, 'settled responses and client secrets are not cached')
  await Promise.resolve()
  waiting.get('one')({ clientSecret: 'fresh-response' })
  await fresh
  assert.equal(calls.length, 3)
})

test('failed checkout creation clears in-flight state and different sign-in request functions remain isolated', async () => {
  let calls = 0
  const request = () => { if (++calls === 1) throw new Error('temporarily busy'); return { clientSecret: 'retry' } }
  await assert.rejects(requestCheckoutBootstrap(request, 'one'), /temporarily busy/)
  assert.deepEqual(await requestCheckoutBootstrap(request, 'one'), { clientSecret: 'retry' })
  const first = requestCheckoutBootstrap(() => ({ owner: 'first' }), 'one')
  const second = requestCheckoutBootstrap(() => ({ owner: 'second' }), 'one')
  assert.notEqual(first, second)
  assert.deepEqual(await first, { owner: 'first' })
  assert.deepEqual(await second, { owner: 'second' })
})
