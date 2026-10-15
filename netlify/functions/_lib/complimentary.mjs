import { createHash, randomBytes } from 'node:crypto'
import { call, HttpError } from './runtime.mjs'
import { billingConfiguration, createStripe, leaseFor, publicBilling, subscriptionSnapshot } from './billing.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const objectId = value => typeof value === 'string' ? value : value?.id
const terminal = new Set(['canceled', 'incomplete_expired'])
const unavailable = () => new HttpError(503, 'We couldn’t confirm that monthly billing has stopped. Your code is saved for this website. Please try applying it again.', 'COMPLIMENTARY_PENDING')

export async function createComplimentaryCode({ db, user, email }) {
  if (typeof email !== 'string' || email.trim().length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
    throw new HttpError(400, 'Enter the email your client uses to sign in to SayGday.', 'INVALID')
  const code = 'SG-' + randomBytes(16).toString('hex').toUpperCase()
  const item = await call(db, 'billing_code_create', { p_user: user.id, p_email: email.trim().toLowerCase(), p_hash: hash(code) })
  return { code, item }
}

// Existing subscriptions must stop at the provider before the database grants
// complimentary access. All provider resources belong to this website's saved
// customer mapping; never accept a customer or subscription from the browser.
async function stopMonthlyBilling(client, account, configuration) {
  const customer = account.stripe_customer_id
  const sessions = await client.checkout.sessions.list({ customer, status: 'open', limit: 100 })
  if (sessions.has_more || !Array.isArray(sessions.data)) throw unavailable()
  for (const session of sessions.data) {
    if (objectId(session.customer) !== customer || session.livemode !== configuration.live || session.mode !== 'subscription') throw unavailable()
    try { await client.checkout.sessions.expire(session.id) }
    catch {
      // A completion racing expiration can create a subscription. Read its
      // current state below, while holding the same database billing lease.
      const current = await client.checkout.sessions.retrieve(session.id)
      if (!['complete', 'expired'].includes(current.status) || objectId(current.customer) !== customer || current.livemode !== configuration.live) throw unavailable()
    }
  }
  const subscriptions = await client.subscriptions.list({ customer, status: 'all', limit: 100 })
  if (subscriptions.has_more || !Array.isArray(subscriptions.data)) throw unavailable()
  const active = subscriptions.data.filter(item => !terminal.has(item.status))
  if (active.length > 1 || subscriptions.data.some(item => objectId(item.customer) !== customer || item.livemode !== configuration.live)) throw unavailable()
  for (const item of active) {
    // No new final invoice, no proration, no refund. Cancellation also stops
    // automatic collection of this subscription's open/draft invoices.
    const ended = await client.subscriptions.cancel(item.id, { invoice_now: false, prorate: false })
    if (ended.status !== 'canceled' || objectId(ended.customer) !== customer || ended.livemode !== configuration.live) throw unavailable()
  }
  const remaining = await client.checkout.sessions.list({ customer, status: 'open', limit: 100 })
  if (remaining.has_more || !Array.isArray(remaining.data) || remaining.data.length) throw unavailable()
  const snapshot = await subscriptionSnapshot(client, account, configuration)
  if (snapshot.stripe_subscription_id && !terminal.has(snapshot.subscription_status)) throw unavailable()
  return snapshot
}

export async function redeemComplimentaryCode({ db, user, business, code, configuration = billingConfiguration(), stripe }) {
  if (typeof code !== 'string' || !/^SG-[A-F0-9]{32}$/.test(code.trim().toUpperCase()))
    throw new HttpError(400, 'Check the complimentary code and try again.', 'INVALID_COMPLIMENTARY_CODE')
  const original = await call(db, 'billing_owner', { p_user: user.id, p_business: business })
  if (original.internal) throw new HttpError(409, 'This admin website already has free access.', 'BILLING_NOT_ENABLED')
  return leaseFor(db, original, async (account, lease) => {
    const args = { p_user: user.id, p_email: user.email, p_business: account.business_id, p_hash: hash(code.trim().toUpperCase()), p_lease: lease }
    const claim = await call(db, 'billing_code_claim', args)
    if (claim.alreadyRedeemed) return { billing: publicBilling(account, configuration) }
    if (account.complimentary) throw new HttpError(409, 'This website already has complimentary access.', 'BILLING_NOT_ENABLED')
    if (account.stripe_customer_id) {
      if (!configuration.stripeReady) throw unavailable()
      try {
        const snapshot = await stopMonthlyBilling(stripe || createStripe(configuration), account, configuration)
        await call(db, 'billing_commit', { p_business: account.business_id, p_lease: lease, p_state: snapshot, p_checkout: {} })
      } catch (error) {
        if (error.code === 'BILLING_LEASE_LOST') throw error
        throw unavailable()
      }
    }
    return { billing: publicBilling(await call(db, 'billing_code_redeem', args), configuration) }
  })
}
