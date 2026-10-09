// Display only. Stripe owns card collection; the server owns entitlement.
const ZONE = 'Australia/Sydney'
const moneyError = 'We could not confirm the checkout amount. Please reload checkout before continuing.'

export function checkoutDay(now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now))
}

export function checkoutDate(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || !Number.isFinite(new Date(seconds * 1000).getTime())) throw new Error('We could not confirm your first billing date. Please reload checkout.')
  return new Intl.DateTimeFormat('en-AU', { timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(seconds * 1000))
}

export function checkoutBootstrap(value, businessId, now = Date.now()) {
  const secret = typeof value?.clientSecret === 'string' ? value.clientSecret : ''
  const match = secret.length <= 2048 && /^(cs_(live|test)_[A-Za-z0-9]+)_secret_[^\s]+$/.exec(secret)
  if (!match || !new RegExp(`^pk_${match[2]}_[A-Za-z0-9]+$`).test(value?.publishableKey || '') || value?.businessId !== businessId || !businessId || !Number.isSafeInteger(value?.expiresAt) || value.expiresAt * 1000 <= now) {
    throw new Error('We could not open this checkout. Please return to Billing and try again.')
  }
  return { ...value, sessionId: match[1], livemode: match[2] === 'live' }
}

export function checkoutView(session, checkout, now = Date.now()) {
  if (session?.id !== checkout.sessionId || session?.livemode !== checkout.livemode) throw new Error('We could not confirm this checkout. Please return to Billing.')
  if (checkout.expiresAt * 1000 <= now || session?.status?.type === 'expired') throw new Error('This checkout has expired. Reload checkout to continue.')
  if (session?.status?.type === 'complete') return { complete: true }
  if (session?.status?.type !== 'open') throw new Error('This checkout is not available. Please return to Billing.')
  // Reading AND showing this value is required by Stripe before confirm().
  const due = session.total?.total
  const recurring = session.recurring
  const next = recurring?.dueNext?.total
  if (session.currency !== 'aud' || session.minorUnitsAmountDivisor !== 100 || recurring?.interval !== 'month' || recurring?.intervalCount !== 1 || next?.minorUnitsAmount !== 4000 || ![0, 4000].includes(due?.minorUnitsAmount) || typeof due?.amount !== 'string' || !due.amount.trim() || due.amount.length > 80) throw new Error(moneyError)
  const trial = recurring.trial
  const trialEnd = trial?.trialEnd
  if (trial != null && (!Number.isSafeInteger(trialEnd) || trialEnd * 1000 <= now || due.minorUnitsAmount !== 0)) throw new Error('We could not confirm your free period. Please reload checkout.')
  if (trial == null && due.minorUnitsAmount !== 4000) throw new Error(moneyError)
  const date = trial == null ? '' : checkoutDate(trialEnd)
  return {
    complete: false,
    date,
    trial: trial != null,
    dueToday: due.amount,
    dueTodayMinor: due.minorUnitsAmount,
    title: date ? `Your billing starts on ${date}` : 'Start your monthly subscription',
    button: date ? 'Confirm card & activate' : 'Subscribe for A$40/month',
    quoteKey: `${date}|${due.minorUnitsAmount}|4000|aud|month`,
  }
}
