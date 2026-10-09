// Stripe is a payment processor, never an authority supplied by the browser.
// Database account leases fence every writer; webhook receipts and snapshots
// commit together. Events request a fresh read, never apply an old event body.
import Stripe from 'stripe'
import { randomInt, randomUUID } from 'node:crypto'
import { call, env, HttpError } from './runtime.mjs'

// Match the stable snapshot version offered by the live account's Workbench.
export const STRIPE_API_VERSION = '2026-08-26.dahlia'
export const CHECKOUT_TRIAL_BUFFER = (48 * 60 + 30) * 60
const TERMINAL = new Set(['canceled', 'incomplete_expired'])
const KNOWN_STATUS = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled', 'paused'])
const SUPPORTED_EVENTS = new Set(['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed', 'customer.subscription.trial_will_end', 'invoice.paid',
  'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.payment_action_required', 'invoice.voided', 'invoice.marked_uncollectible'])
const seconds = value => Math.floor(Date.parse(value || '') / 1000)
const stripeTimestamp = value => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value * 1000).getTime())
const iso = value => stripeTimestamp(value) ? new Date(value * 1000).toISOString() : null
const objectId = value => typeof value === 'string' ? value : value?.id
const unavailable = () => new HttpError(503, 'Billing is temporarily unavailable. Please try again shortly.', 'BILLING_UNAVAILABLE')
const busy = () => new HttpError(409, 'We’re updating your billing. Please try again in a moment.', 'BILLING_BUSY')
// Publishable browser identifier, intentionally public. Secret and webhook
// keys remain server environment values. Scope this production fallback to
// this exact site and price; other deployments must supply their own pk_*.
const SAYGDAY_PUBLIC_STRIPE_KEY = 'pk_live_51UA2P7R8qEoKoynxKDV4Q6I5JpVH9q80xSh3VJLzNWvizyQgWfsEqlGfjJb6qPTMcGaWFrc1YZgf0QXgCeCov5ak00i3j7v0Qm'
const SAYGDAY_MONTHLY_PRICE = 'price_1UOX45R8qEoKoynxBDir6jA0'
const SAYGDAY_PREVIOUS_MONTHLY_PRICE = 'price_1UOA0sR8qEoKoynxWAoOrDeA'
const MONTHLY_AMOUNT = 4000
// The earlier live price remains readable during the owner's subscription
// migration. It can never be selected for a new checkout by this release.
const previousPrice = (id, configuration) => configuration.live && configuration.publicUrl === 'https://saygday.ai'
  && configuration.priceId === SAYGDAY_MONTHLY_PRICE && id === SAYGDAY_PREVIOUS_MONTHLY_PRICE

export function billingConfiguration(read = env) {
  const key = read('SAYGDAY_STRIPE_SECRET_KEY') || ''
  const configuredPublishableKey = read('SAYGDAY_STRIPE_PUBLISHABLE_KEY')
  const mode = read('SAYGDAY_STRIPE_MODE') || ''
  const priceId = read('SAYGDAY_STRIPE_PRICE_ID') || ''
  const portalConfigurationId = read('SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID') || ''
  const webhookSecret = read('SAYGDAY_STRIPE_WEBHOOK_SECRET') || ''
  let publicUrl = null
  try {
    const url = new URL(read('SAYGDAY_PUBLIC_URL'))
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash)
      publicUrl = url.origin
  } catch { /* No untrusted Host-header fallback. */ }
  const publishableKey = configuredPublishableKey ?? (mode === 'live' && publicUrl === 'https://saygday.ai'
    && priceId === SAYGDAY_MONTHLY_PRICE ? SAYGDAY_PUBLIC_STRIPE_KEY : '')
  const validKey = /^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(key) && key.split('_')[1] === mode
  const publishableKeyReady = /^pk_(live|test)_[A-Za-z0-9]+$/.test(publishableKey) && publishableKey.split('_')[1] === mode
  const stripeReady = validKey && /^price_[A-Za-z0-9]+$/.test(priceId)
  const portalReady = validKey && !!publicUrl && /^bpc_[A-Za-z0-9]+$/.test(portalConfigurationId)
  const webhookReady = stripeReady && /^whsec_[A-Za-z0-9]+$/.test(webhookSecret)
  return { key, publishableKey, mode, live: mode === 'live', priceId, portalConfigurationId, webhookSecret, publicUrl,
    keyReady: validKey, publishableKeyReady, stripeReady, portalReady, webhookReady,
    checkoutReady: stripeReady && portalReady && webhookReady && publishableKeyReady }
}

export function createStripe(configuration = billingConfiguration()) {
  if (!configuration.keyReady) throw unavailable()
  return new Stripe(configuration.key, { apiVersion: STRIPE_API_VERSION, timeout: 5000, maxNetworkRetries: 1 })
}

export function stripeUrl(value, purpose) {
  let url
  try { url = new URL(value) } catch { throw unavailable() }
  const host = purpose === 'portal' ? 'billing.stripe.com' : 'checkout.stripe.com'
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) throw unavailable()
  return url.href
}

export function exactPrice(price, configuration, { forCheckout = false } = {}) {
  const legacy = !forCheckout && previousPrice(price?.id, configuration)
  return !!price && (price.id === configuration.priceId || legacy) && price.livemode === configuration.live
    && price.currency === 'aud' && price.unit_amount === (legacy ? 3000 : MONTHLY_AMOUNT) && price.tax_behavior === 'inclusive' && price.type === 'recurring'
    && price.billing_scheme === 'per_unit' && price.recurring?.interval === 'month'
    && price.recurring.interval_count === 1 && price.recurring.usage_type === 'licensed'
    && !price.transform_quantity && (!forCheckout || price.active === true)
}

export function publicBilling(account, configuration = billingConfiguration(), now = Date.now()) {
  if (!account) return { state: 'trial_not_started', accessAllowed: false, trialEndsAt: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, checkoutAvailable: false, portalAvailable: false, subscriptionScheduled: false }
  if (typeof account.enabled !== 'boolean') return { state: 'unavailable', accessAllowed: false, trialEndsAt: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, checkoutAvailable: false, portalAvailable: false, subscriptionScheduled: false }
  if (account.internal === true) return { state: 'internal', accessAllowed: true, trialEndsAt: null, currentPeriodEnd: null,
    cancelAtPeriodEnd: false, checkoutAvailable: false, portalAvailable: !!(account.stripe_customer_id && configuration.portalReady), subscriptionScheduled: false }
  const current = Math.floor(now / 1000)
  const trial = seconds(account.trial_ends_at) > current
  // Recompute expiry in this response as well: a stale snapshot cannot grant
  // access just because its stored access_allowed was once true.
  const paid = account.subscription_status === 'active' && account.price_valid === true
    && seconds(account.current_period_end) > current && seconds(account.synced_at) > current - 86400 && seconds(account.synced_at) <= current
  const accessAllowed = account.enabled === false || trial || paid
  const subscriptionScheduled = account.subscription_status === 'trialing' && account.price_valid === true
  let state
  if (!account.enabled) state = 'setup_pending'
  else if (paid) state = account.cancel_at_period_end ? 'canceling' : 'active'
  else if (trial) state = seconds(account.trial_ends_at) - current <= CHECKOUT_TRIAL_BUFFER ? 'trial_ending' : 'trial'
  else if (account.subscription_status === 'active' || account.subscription_status === 'trialing') state = 'unavailable'
  else if (['past_due', 'unpaid', 'incomplete', 'paused', 'canceled'].includes(account.subscription_status)) state = account.subscription_status
  else state = account.trial_ends_at ? 'trial_expired' : account.card_required && account.website_verified ? 'card_required' : 'trial_not_started'
  const hasSubscription = account.stripe_subscription_id && !TERMINAL.has(account.subscription_status)
  return { state, accessAllowed, cardRequired: account.card_required === true, trialEndsAt: account.trial_ends_at || null, currentPeriodEnd: account.current_period_end || null,
    cancelAtPeriodEnd: !!account.cancel_at_period_end, subscriptionScheduled,
    checkoutAvailable: !!(account.enabled && configuration.checkoutReady && (account.trial_ends_at || (account.card_required && account.website_verified)) && !hasSubscription && state !== 'trial_ending'),
    portalAvailable: !!(account.stripe_customer_id && configuration.portalReady) }
}

async function leaseFor(db, account, work) {
  const locked = await call(db, 'billing_acquire', { p_business: account.business_id })
  if (!locked) throw busy()
  try { return await work(locked.account, locked.lease) }
  finally {
    // A failed release only leaves the bounded lease until expiry. It must not
    // turn a successful payment operation into an invitation to charge again.
    try { await call(db, 'billing_release', { p_business: account.business_id, p_lease: locked.lease }) } catch { /* expiry releases it */ }
  }
}
async function commit(db, account, lease, extra) {
  return call(db, 'billing_commit', { p_business: account.business_id, p_lease: lease, ...extra })
}

export async function subscriptionSnapshot(stripe, account, configuration) {
  const customer = account.stripe_customer_id
  if (!customer) return { stripe_subscription_id: null, subscription_status: 'none', price_valid: false,
    current_period_end: null, cancel_at_period_end: false, synced_at: true }
  // A single customer should have one subscription. Bound anomalous accounts
  // and fail closed rather than silently ignoring page two.
  const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] })
  if (list.has_more || !Array.isArray(list.data)) throw unavailable()
  if (list.data.some(sub => objectId(sub.customer) !== customer || sub.livemode !== configuration.live)) throw unavailable()
  const live = list.data.filter(sub => !TERMINAL.has(sub.status))
  const sub = (live.length ? live : list.data).sort((a, b) => b.created - a.created)[0]
  if (!sub) return { stripe_subscription_id: null, subscription_status: 'none', price_valid: false,
    current_period_end: null, cancel_at_period_end: false, synced_at: true }
  const item = sub.items?.data?.[0]
  const invoice = sub.latest_invoice
  const paid = invoice && typeof invoice === 'object' && invoice.status === 'paid' && invoice.currency === 'aud'
    && invoice.amount_paid === item?.price?.unit_amount && invoice.total === item?.price?.unit_amount
  // Only the current provider subscription from our persisted Checkout attempt
  // can start a card-backed trial. Neither a redirect nor a customer ID proves it.
  const startsTrial = account.card_required === true && !account.trial_ends_at
    && account.first_website_verified_at && account.checkout?.key
    && sub.metadata?.saygday_checkout_key === account.checkout.key
    && sub.metadata?.saygday_business_id === account.business_id
    && /^pm_[A-Za-z0-9]+$/.test(objectId(sub.default_payment_method) || '')
    && ['trialing', 'active', 'canceled'].includes(sub.status)
    && stripeTimestamp(sub.trial_start) && stripeTimestamp(sub.trial_end)
    && sub.trial_end - sub.trial_start === 14 * 86400
    && sub.trial_start >= seconds(account.first_website_verified_at)
    && sub.trial_start <= Math.floor(Date.now() / 1000)
  const trialMatches = sub.status !== 'trialing' || startsTrial
    || (Number.isFinite(seconds(account.trial_ends_at)) && sub.trial_end === seconds(account.trial_ends_at))
  // The portal can set cancel_at with cancel_at_period_end=false (including
  // flexible subscriptions). Keep the earlier of that date and paid time;
  // a cancellation date never supplies a missing paid period or extends it.
  const hasCancelAt = sub.cancel_at != null
  const validCancelAt = !hasCancelAt || stripeTimestamp(sub.cancel_at)
  const cancelAt = hasCancelAt && validCancelAt ? sub.cancel_at : null
  const periodEnd = stripeTimestamp(item?.current_period_end) ? item.current_period_end : null
  const accessEnd = periodEnd === null || !validCancelAt ? null : cancelAt === null ? periodEnd : Math.min(periodEnd, cancelAt)
  const valid = live.length <= 1 && sub.items?.data?.length === 1 && !sub.items?.has_more && item.quantity === 1
    && exactPrice(item.price, configuration) && sub.collection_method === 'charge_automatically'
    && !sub.pause_collection && !sub.pending_update && !sub.discounts?.length && !sub.default_tax_rates?.length
    && !item.discounts?.length && !item.tax_rates?.length && trialMatches && validCancelAt && periodEnd !== null && (sub.status !== 'active' || paid)
  return { stripe_subscription_id: sub.id, subscription_status: KNOWN_STATUS.has(sub.status) ? sub.status : 'unpaid',
    ...(valid && startsTrial ? { trial_started_at: iso(sub.trial_start), trial_ends_at: iso(sub.trial_end) } : {}),
    price_valid: !!valid, current_period_end: iso(accessEnd), cancel_at_period_end: sub.cancel_at_period_end === true || cancelAt !== null, synced_at: true }
}

export async function reconcileAccount({ db, account, stripe, configuration = billingConfiguration(), event = null }) {
  return leaseFor(db, account, async (fresh, lease) => {
    if (event && await call(db, 'billing_event_seen', { p_event_id: event.id })) return { duplicate: true, account: fresh }
    const state = await subscriptionSnapshot(stripe || createStripe(configuration), fresh, configuration)
    return commit(db, fresh, lease, { p_state: state, p_event_id: event?.id || null, p_event_type: event?.type || null })
  })
}

export async function billingStatus({ db, user, business = null, configuration = billingConfiguration(), stripe, now }) {
  let account = await call(db, 'billing_owner', { p_user: user.id, p_business: business })
  if (account?.stripe_customer_id && configuration.stripeReady) {
    try { account = (await reconcileAccount({ db, account, configuration, stripe })).account }
    catch { /* A known, unexpired local trial/paid window survives an outage. */ }
  }
  return publicBilling(account, configuration, now ?? Date.now())
}

async function validatePortal(stripe, configuration) {
  const portal = await stripe.billingPortal.configurations.retrieve(configuration.portalConfigurationId)
  const f = portal.features
  if (!portal.active || portal.livemode !== configuration.live || !f?.payment_method_update?.enabled || !f.invoice_history?.enabled
    || !f.subscription_cancel?.enabled || f.subscription_cancel.mode !== 'at_period_end'
    || f.subscription_cancel.proration_behavior !== 'none' || f.subscription_update?.enabled
    || f.customer_update?.enabled || f.subscription_pause?.enabled || f.subscription_cancel.retention?.type)
    throw unavailable()
}

export async function billingPortal({ db, user, business = null, configuration = billingConfiguration(), stripe }) {
  if (!configuration.portalReady) throw unavailable()
  const account = await call(db, 'billing_owner', { p_user: user.id, p_business: business })
  if (!account?.stripe_customer_id) throw new HttpError(409, 'Choose the monthly plan first.', 'NO_BILLING_CUSTOMER')
  const client = stripe || createStripe(configuration)
  await validatePortal(client, configuration)
  const session = await client.billingPortal.sessions.create({ customer: account.stripe_customer_id,
    configuration: configuration.portalConfigurationId, return_url: `${configuration.publicUrl}/app/settings?business=${encodeURIComponent(account.business_slug)}&billing=returned` })
  return { url: stripeUrl(session.url, 'portal') }
}

function validCheckout(session, account, configuration, operation) {
  if (!session || objectId(session.customer) !== account.stripe_customer_id || session.mode !== 'subscription'
    || session.livemode !== configuration.live || !/^cs_[A-Za-z0-9_]+$/.test(session.id)
    || session.metadata?.saygday_checkout_key !== operation.key
    || !['open', 'complete', 'expired'].includes(session.status)) throw unavailable()
  return session
}

function customCheckout(session, account, configuration, current) {
  if (session.ui_mode !== 'elements' || session.status !== 'open' || !stripeTimestamp(session.expires_at)
    || session.expires_at <= current || typeof session.client_secret !== 'string'
    || !session.client_secret.startsWith(`${session.id}_secret_`) || session.client_secret.length <= session.id.length + 8) throw unavailable()
  // This response is authenticated and no-store. The client secret is held in
  // page memory only: never save it in our database, URLs or application logs.
  return { clientSecret: session.client_secret, publishableKey: configuration.publishableKey,
    expiresAt: session.expires_at, businessId: account.business_id }
}

async function recoverCheckout(client, account, configuration, operation) {
  if (!operation.key) return null
  if (operation.session_id) {
    try { return validCheckout(await client.checkout.sessions.retrieve(operation.session_id), account, configuration, operation) }
    catch (error) { if (error.code !== 'resource_missing') throw error }
  }
  // A missing response or temporary lookup failure cannot authorise a second
  // subscription. Recover only the exact durable attempt, across all statuses.
  const sessions = await client.checkout.sessions.list({ customer: account.stripe_customer_id, limit: 100 })
  if (sessions.has_more || !Array.isArray(sessions.data)) throw unavailable()
  const matches = sessions.data.filter(candidate => candidate.metadata?.saygday_checkout_key === operation.key)
  if (matches.length > 1 || (!matches.length && operation.session_id)) throw unavailable()
  return matches.length ? validCheckout(matches[0], account, configuration, operation) : null
}

export async function billingCheckout({ db, user, business = null, configuration = billingConfiguration(), stripe, now = Date.now() }) {
  if (!configuration.checkoutReady) throw unavailable()
  const original = await call(db, 'billing_owner', { p_user: user.id, p_business: business })
  if (!original) throw new HttpError(409, 'Add your website first.', 'NO_BUSINESS')
  if (original.internal || !original.enabled || (!original.trial_ends_at && !(original.card_required && original.website_verified))) throw new HttpError(409, 'Billing setup is still being completed.', 'BILLING_NOT_ENABLED')
  const client = stripe || createStripe(configuration)
  return leaseFor(db, original, async (account, lease) => {
    const current = Math.floor(now / 1000)
    const price = await client.prices.retrieve(configuration.priceId)
    if (!exactPrice(price, configuration, { forCheckout: true })) throw unavailable()
    await validatePortal(client, configuration)
    let operation = account.checkout || {}
    if (!account.stripe_customer_id) {
      // The durable operation precedes the provider call. Replaying exactly
      // this request recovers a response lost after Stripe created a customer.
      if (!operation.customer_key) {
        operation = { customer_key: `sg-customer-${randomUUID()}`, customer_created_at: now }
        account = (await commit(db, account, lease, { p_checkout: operation })).account
      }
      if (now - operation.customer_created_at > 23 * 3600000) throw new HttpError(409, 'We need to check an unfinished billing setup. Please contact us.', 'BILLING_REVIEW_REQUIRED')
      const customer = await client.customers.create({ metadata: { saygday_business_id: account.business_id } }, { idempotencyKey: operation.customer_key })
      if (customer.livemode !== configuration.live || !/^cus_[A-Za-z0-9]+$/.test(customer.id)) throw unavailable()
      account = (await commit(db, account, lease, { p_state: { stripe_customer_id: customer.id }, p_checkout: {} })).account
      operation = {}
    }
    let snapshot = await subscriptionSnapshot(client, account, configuration)
    account = (await commit(db, account, lease, { p_state: snapshot })).account
    if (snapshot.stripe_subscription_id && !TERMINAL.has(snapshot.subscription_status))
      throw new HttpError(409, 'You already have a subscription. Open Manage billing to update it.', 'SUBSCRIPTION_EXISTS')

    const retiresPrice = previousPrice(operation.params?.line_items?.[0]?.price, configuration)
    if (operation.key && (operation.params?.mode !== 'subscription' || operation.params.customer !== account.stripe_customer_id
      || operation.params.line_items?.length !== 1 || (operation.params.line_items[0].price !== configuration.priceId && !retiresPrice)
      || operation.params.line_items[0].quantity !== 1)) throw unavailable()
    let session = await recoverCheckout(client, account, configuration, operation)
    if (!session && operation.key && operation.params.expires_at > current && (operation.params.ui_mode !== 'elements' || retiresPrice)) {
      // An earlier hosted or A$30 attempt may have lost its create response
      // before this rollout. Replay its ORIGINAL parameters/key, then expire it; changing
      // a durable request under the old key would break Stripe idempotency.
      session = validCheckout(await client.checkout.sessions.create(operation.params, { idempotencyKey: operation.key }), account, configuration, operation)
    }
    if (session?.status === 'open' && !retiresPrice && session.ui_mode === 'elements' && session.expires_at > current) {
      const result = customCheckout(session, account, configuration, current)
      await commit(db, account, lease, { p_checkout: { ...operation, session_id: session.id, expires_at: session.expires_at } })
      return result
    }
    if (session?.status === 'open') {
      // Retire the old hosted link or A$30 checkout before replacement. A
      // customer can confirm in another tab while this request holds our DB
      // lease; only Stripe's successful expiration makes replacement safe.
      try { session = validCheckout(await client.checkout.sessions.expire(session.id), account, configuration, operation) }
      catch {
        session = validCheckout(await client.checkout.sessions.retrieve(session.id), account, configuration, operation)
        if (session.status !== 'complete' && session.status !== 'expired') throw unavailable()
      }
      snapshot = await subscriptionSnapshot(client, account, configuration)
      account = (await commit(db, account, lease, { p_state: snapshot })).account
      if (snapshot.stripe_subscription_id && !TERMINAL.has(snapshot.subscription_status))
        throw new HttpError(409, 'You already have a subscription. Open Manage billing to update it.', 'SUBSCRIPTION_EXISTS')
      if (session.status === 'open') throw unavailable()
    }
    // Completion may race the subscription list above. Only the exact linked
    // subscription being confirmed terminal permits a fresh purchase.
    if (session?.status === 'complete' && !(TERMINAL.has(snapshot.subscription_status)
      && objectId(session.subscription) === snapshot.stripe_subscription_id))
      throw new HttpError(409, 'Your payment is being confirmed. Refresh billing shortly.', 'BILLING_PENDING')
    if (session || (operation.key && operation.params?.expires_at <= current)) {
      operation = {}
      account = (await commit(db, account, lease, { p_checkout: {} })).account
    }
    if (!operation.key) {
      const firstCardTrial = account.card_required === true && !account.trial_ends_at
      const remaining = firstCardTrial ? 0 : seconds(account.trial_ends_at) - current
      if (remaining > 0 && remaining <= CHECKOUT_TRIAL_BUFFER)
        throw new HttpError(409, 'Your free time is still running. Choose the monthly plan once it ends.', 'TRIAL_ENDING')
      const key = `sg-checkout-${randomUUID()}`
      const params = { mode: 'subscription', ui_mode: 'elements', customer: account.stripe_customer_id, payment_method_collection: 'always',
        line_items: [{ price: configuration.priceId, quantity: 1 }],
        // Account defaults may enable Stripe's merchant-of-record service,
        // which requires localised prices and tax. Keep this fixed AUD offer
        // in direct billing; payment methods follow the Dashboard settings.
        managed_payments: { enabled: false },
        integration_identifier: `saygday-monthly-${Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join('')}`,
        allow_promotion_codes: false, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
        client_reference_id: account.business_id, metadata: { saygday_checkout_key: key },
        return_url: `${configuration.publicUrl}/app/billing?business=${encodeURIComponent(account.business_slug)}&checkout=success`,
        expires_at: current + (remaining > 0 ? Math.min(86400, remaining - 48 * 3600) : 86400),
        subscription_data: { metadata: { saygday_business_id: account.business_id, saygday_checkout_key: key },
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          ...(firstCardTrial ? { trial_period_days: 14 } : remaining > 0 ? { trial_end: seconds(account.trial_ends_at) } : {}) } }
      operation = { key, created_at: now, params }
      account = (await commit(db, account, lease, { p_checkout: operation })).account
    }
    // Same params and key across retries; no client prices, customer IDs,
    // return URLs, user IDs or trial extensions are accepted.
    session = validCheckout(await client.checkout.sessions.create(operation.params, { idempotencyKey: operation.key }), account, configuration, operation)
    const result = customCheckout(session, account, configuration, current)
    await commit(db, account, lease, { p_checkout: { ...operation, session_id: session.id, expires_at: session.expires_at } })
    return result
  })
}

export async function stripeWebhook({ request, db, configuration = billingConfiguration(), stripe }) {
  if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this request.', 'METHOD_NOT_ALLOWED')
  if (!configuration.webhookReady) throw unavailable()
  if (Number(request.headers.get('content-length')) > 262144) throw new HttpError(413, 'Webhook too large.', 'BODY_TOO_LARGE')
  const raw = Buffer.from(await request.arrayBuffer())
  if (raw.length > 262144) throw new HttpError(413, 'Webhook too large.', 'BODY_TOO_LARGE')
  const client = stripe || createStripe(configuration)
  let event
  try { event = client.webhooks.constructEvent(raw, request.headers.get('stripe-signature') || '', configuration.webhookSecret, 300) }
  catch { throw new HttpError(400, 'Invalid webhook signature.', 'INVALID_SIGNATURE') }
  if (event.livemode !== configuration.live || event.account || event.api_version !== STRIPE_API_VERSION)
    throw new HttpError(400, 'Webhook configuration does not match.', 'WEBHOOK_CONFIGURATION')
  if (!SUPPORTED_EVENTS.has(event.type)) return { received: true, ignored: true }
  if (await call(db, 'billing_event_seen', { p_event_id: event.id })) return { received: true, duplicate: true }
  const customer = objectId(event.data?.object?.customer)
  if (!customer || !/^cus_[A-Za-z0-9]+$/.test(customer)) return { received: true, ignored: true }
  // Only the service's pre-existing mapping establishes ownership. Neither
  // Checkout metadata nor a signed event can assign an unrelated customer.
  const account = await call(db, 'billing_by_customer', { p_customer: customer })
  if (!account) return { received: true, ignored: true }
  const result = await reconcileAccount({ db, account, stripe: client, configuration, event })
  return { received: true, duplicate: result.duplicate }
}

export async function reconcileBillingBatch({ db, configuration = billingConfiguration(), stripe, now = () => Date.now() }) {
  if (!configuration.stripeReady) return { processed: 0, failed: 0 }
  const client = stripe || createStripe(configuration)
  const accounts = await call(db, 'billing_reconcile_batch', { p_limit: 10 })
  const deadline = now() + 18000
  let processed = 0, failed = 0, index = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < accounts.length && now() < deadline) {
      const account = accounts[index++]
      try { await reconcileAccount({ db, account, stripe: client, configuration }); processed++ } catch { failed++ }
    }
  }))
  return { processed, failed }
}

