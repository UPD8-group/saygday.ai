// Display only. Access and all subscription changes are decided by the server.
export const UNAVAILABLE_BILLING = Object.freeze({ state: 'unavailable', accessAllowed: false, checkoutAvailable: false, portalAvailable: false })
const STATES = new Set(['internal', 'setup_pending', 'card_required', 'trial_not_started', 'trial', 'trial_ending', 'trial_expired', 'active', 'canceling', 'past_due', 'unpaid', 'incomplete', 'canceled', 'paused', 'unavailable'])

export function billingDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  return new Date(value).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}

export function billingView(value) {
  const billing = value && STATES.has(value.state) ? value : UNAVAILABLE_BILLING
  const allowed = billing.accessAllowed === true && billing.state !== 'unavailable'
  const trialEnd = billingDate(billing.trialEndsAt)
  const periodEnd = billingDate(billing.currentPeriodEnd)
  const subscribedTrial = billing.subscriptionScheduled === true
  const trialPlan = subscribedTrial
    ? billing.cancelAtPeriodEnd === true
      ? ' Your subscription is set to end with your free period. It will not renew or start monthly billing. You can manage this in the billing portal.'
      : ' Your subscription is scheduled at A$30 a month (AUD) after your free period. Manage or cancel it in the billing portal.'
    : ' No payment is taken unless you choose to subscribe.'
  const pause = allowed || ['card_required', 'trial_not_started'].includes(billing.state) ? '' : ' Your customer chat is paused. You can still edit answers and read enquiries.'
  const states = {
    internal: ['Internal business', 'This website is marked as an internal or test business. No subscription is needed.'],
    setup_pending: ['Billing is being set up', 'Paid upgrades will be available here once billing is ready. No payment is taken automatically.'],
    card_required: ['Ready to go live', 'Your website is verified. Add your card through Stripe to activate your chat and start 14 free days. Then A$30/month AUD automatically unless you cancel. Nothing to pay today.'],
    trial_not_started: ['Build and preview for free', 'Check your answers and verify your website first. Then add your card to activate your chat and start 14 free days. A$30/month AUD afterwards unless you cancel.'],
    trial: ['Your free period is running', `Your 14 free days${trialEnd ? ` end on ${trialEnd}` : ' are in progress'}.${trialPlan}`],
    trial_ending: ['Your free period is nearly over', `Your free period${trialEnd ? ` ends on ${trialEnd}` : ' is nearly over'}.${subscribedTrial ? trialPlan : ' Upgrade will be available when it ends, so you keep all of your free time. No payment is taken automatically.'}`],
    trial_expired: ['Your free period has ended', 'Upgrade to keep your customer chat running for A$30 a month (AUD).'],
    active: ['Your subscription is active', `A$30 a month (AUD).${periodEnd ? ` Your current paid period ends on ${periodEnd}.` : ''}`],
    canceling: ['Your subscription is ending', `${periodEnd ? `Your subscription ends on ${periodEnd}.` : 'Your subscription is set to end.'} It will not renew. You can manage this in the billing portal.`],
    past_due: ['Your payment needs attention', 'We couldn’t confirm your latest payment. Open the billing portal to check your payment method and any unpaid invoice.'],
    unpaid: ['Your payment is overdue', 'Open the billing portal to check your unpaid invoice and payment method.'],
    incomplete: ['Your payment is not complete', 'Your subscription is not active yet. Check your payment in the billing portal, then refresh your billing status.'],
    canceled: ['Your subscription has ended', 'Start a new subscription to run your customer chat again for A$30 a month (AUD).'],
    paused: ['Your subscription is paused', 'Open the billing portal to check your subscription, then refresh your billing status.'],
    unavailable: ['We couldn’t check your billing', 'Refresh your billing status to try again.'],
  }
  const [title, description] = states[billing.state]
  return {
    state: billing.state, title, description: description + pause, accessAllowed: allowed,
    checkoutLabel: billing.state === 'card_required' ? 'Activate — 14 days free' : 'Upgrade — A$30/month',
    checkoutAvailable: billing.checkoutAvailable === true && billing.state !== 'unavailable',
    portalAvailable: billing.portalAvailable === true,
    needsAttention: !allowed || ['trial_ending', 'canceling', 'past_due'].includes(billing.state),
  }
}

export function billingRedirect(value, action) {
  const host = action === 'billingCheckout' ? 'checkout.stripe.com' : action === 'billingPortal' ? 'billing.stripe.com' : ''
  let url
  try { url = new URL(value) } catch { throw new Error('We couldn’t open billing. Please try again.') }
  if (!host || url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) {
    throw new Error('We couldn’t open billing. Please try again.')
  }
  return url.href
}

// The return address can be typed by anyone. It is a prompt to refresh, never
// evidence of payment or permission to run the customer chat.
export function billingReturn(search) {
  const params = new URLSearchParams(search)
  if (params.get('checkout') === 'success') return 'confirming'
  if (['canceled', 'cancelled'].includes(params.get('checkout'))) return 'canceled'
  if (params.get('billing') === 'returned') return 'returned'
  return ''
}

export function billingConfirmed(billing) {
  return billing?.state === 'active' || billing?.state === 'canceling' || (['trial', 'trial_ending'].includes(billing?.state) && billing?.subscriptionScheduled === true)
}

