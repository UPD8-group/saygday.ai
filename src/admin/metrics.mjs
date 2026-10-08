// The admin page's numbers (/admin), worked out from what /api/admin sends
// (netlify/functions/_lib/admin.mjs): where each business is in its free 14
// days, how far it has got towards a live chat, and the numbers an investor
// asks for. Plain functions with no page in them, so test/admin.test.mjs
// checks them directly. SayGday's own and test businesses (plan "internal")
// are listed, but counted in no total.

export const TRIAL_DAYS = 14 // site/pricing.html: "Your first 14 days are free."
export const PRICE = 30 // A$ a month, site/pricing.html
export const SCAN_COST = Object.freeze([0.25, 0.45]) // A$ a website scan, README.md
const DAY = 86400000

const time = value => {
  const parsed = typeof value === 'number' ? value : Date.parse(value ?? '')
  return Number.isFinite(parsed) ? parsed : null
}
const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0)
export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// ---- Canberra's calendar (the database counts days and weeks the same way) ----

const SYDNEY = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' })
// "2026-10-05": the day it was in Canberra.
export function sydneyDay(value) {
  const at = time(value)
  if (at === null) return null
  const parts = Object.fromEntries(SYDNEY.formatToParts(at).map(part => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
// The Monday that starts a day's week.
export function mondayOf(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
const addDays = (day, days) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// ---- Words for numbers --------------------------------------------------------

const WHOLE = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const CENTS = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const number = value => WHOLE.format(Math.round(Number(value) || 0))
// "A$30", "A$5.40"; cents: true for both ends of a range to match.
export function dollars(value, { cents } = {}) {
  const amount = Number(value) || 0
  return `A$${(cents ?? !Number.isInteger(amount)) ? CENTS.format(amount) : WHOLE.format(amount)}`
}
export const percent = value => (value === null || value === undefined || !Number.isFinite(value) ? '–' : `${Math.round(value * 100)}%`)
const DATE = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short', year: 'numeric' })
const SHORT = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'short' })
// "5 Oct 2026", or "5 Oct" for a short label. A "2026-10-05" day is a day.
export function dateLabel(value, { short = false } = {}) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(`${value}T12:00:00+10:00`) : time(value)
  return at === null ? '' : (short ? SHORT : DATE).format(at)
}

// ---- One business ------------------------------------------------------------

// Where a business is with SayGday: its plan, set by hand on the admin page,
// and for one still on trial, which of its 14 days it's on. The free days run
// from when the website was added.
export function stageOf(business, now = Date.now()) {
  const billing = business.billing
  if (business.plan === 'internal') return { endsAt: null, key: 'internal', label: 'Ours / test' }
  if (billing?.enabled) {
    const paid = billing.subscriptionStatus === 'active' && billing.priceValid === true
      && time(billing.currentPeriodEnd) > now && time(billing.syncedAt) > now - DAY && time(billing.syncedAt) <= now
    if (paid) return { endsAt: billing.trialEndsAt, key: 'paying', label: 'Paying' }
    if (!billing.trialStartedAt) return { endsAt: null, key: 'not_started', label: 'Trial not started' }
    if (time(billing.trialEndsAt) <= now && billing.hasCustomer) return { endsAt: billing.trialEndsAt, key: 'cancelled', label: 'Payment inactive' }
  }
  const start = time(billing?.enabled ? billing.trialStartedAt : business.createdAt) ?? now
  const endsAt = billing?.enabled ? time(billing.trialEndsAt) : start + TRIAL_DAYS * DAY
  const base = { endsAt: new Date(endsAt).toISOString() }
  if (!billing?.enabled && business.plan === 'paying') return { ...base, key: 'paying', label: 'Paying' }
  if (!billing?.enabled && business.plan === 'cancelled') return { ...base, key: 'cancelled', label: 'Cancelled' }
  if (business.plan === 'internal') return { ...base, key: 'internal', label: 'Ours / test' }
  if (now < endsAt) {
    const day = Math.min(TRIAL_DAYS, Math.max(1, Math.floor((now - start) / DAY) + 1))
    const daysLeft = Math.ceil((endsAt - now) / DAY)
    return { ...base, key: daysLeft <= 3 ? 'ending' : 'trial', label: `Day ${day} of ${TRIAL_DAYS}`, day, daysLeft }
  }
  const daysAgo = Math.floor((now - endsAt) / DAY)
  return { ...base, key: 'ended', label: daysAgo ? `Trial ended ${plural(daysAgo, 'day')} ago` : 'Trial ended today', daysAgo }
}

// The road from a website address to customers reading its answers, in order:
// each step's name once done, and what's next while it isn't.
export const STEPS = Object.freeze([
  { key: 'added', label: 'Website added', todo: 'add a website', done: () => true },
  { key: 'drafted', label: 'Questions drafted', todo: 'draft questions', done: business => (business.answers?.approved || 0) + (business.answers?.drafts || 0) > 0 },
  { key: 'approved', label: 'Answers approved', todo: 'approve answers', done: business => (business.answers?.approved || 0) > 0 },
  { key: 'proved', label: 'Website proved', todo: 'prove the website', done: business => Boolean(business.websiteVerifiedAt) },
  { key: 'live', label: 'Chat on the website', todo: 'add the chat button', done: business => Boolean(business.buttonSeenAt) },
  { key: 'read', label: 'Answers read by customers', todo: 'a customer reads an answer', done: business => (business.answers?.read || 0) > 0 },
].map(Object.freeze))
// How many steps in a row a business has done, and the one it's stuck on.
export function progressOf(business) {
  let done = 0
  while (done < STEPS.length && STEPS[done].done(business)) done++
  return { done, next: STEPS[done] || null }
}

// ---- Everything ----------------------------------------------------------------

export function summarise(data, now = time(data?.generatedAt) ?? Date.now()) {
  const businesses = (data?.businesses || []).map(business => ({ ...business, stage: stageOf(business, now), progress: progressOf(business) }))
  const counted = businesses.filter(business => business.plan !== 'internal')
  const owned = new Map()
  for (const business of businesses) owned.set(business.ownerId, [...(owned.get(business.ownerId) || []), business])
  const accounts = (data?.accounts || []).map(account => ({ ...account, businesses: owned.get(account.id) || [] }))
    .sort((a, b) => (time(b.createdAt) || 0) - (time(a.createdAt) || 0))
  // A sign-in whose every business is ours is ours too.
  const realAccounts = accounts.filter(account => !account.businesses.length || account.businesses.some(business => business.plan !== 'internal'))
  const signedIn = realAccounts.filter(account => account.confirmed)

  const within = (value, days) => { const at = time(value); return at !== null && now - at < days * DAY }
  const count = (items, test) => items.filter(test).length
  const at = key => counted.filter(business => business.stage.key === key)
  const paying = at('paying').length, ended = at('ended').length, cancelled = at('cancelled').length
  const scans = sum(counted, business => business.scans?.total)
  const finished = paying + cancelled + ended
  const totals = {
    signIns: signedIn.length, signIns7: count(signedIn, account => within(account.createdAt, 7)),
    signIns30: count(signedIn, account => within(account.createdAt, 30)),
    businesses: counted.length, businesses7: count(counted, business => within(business.createdAt, 7)),
    businesses30: count(counted, business => within(business.createdAt, 30)),
    inTrial: at('trial').length + at('ending').length, endingSoon: at('ending').length, trialEnded: ended, paying, cancelled,
    mrr: paying * PRICE, arr: paying * PRICE * 12, waiting: ended * PRICE,
    // Of the businesses whose free days are over (or that already pay), the share paying.
    trialToPaid: finished ? paying / finished : null, trialFinished: finished,
    proved: count(counted, business => business.websiteVerifiedAt), live7: count(counted, business => within(business.buttonSeenAt, 7)),
    answersRead: sum(counted, business => business.answers?.read),
    answersRead7: sum(counted, business => business.activity?.read7), answersRead30: sum(counted, business => business.activity?.read30),
    questions: sum(counted, business => business.enquiries?.total), questions30: sum(counted, business => business.enquiries?.last30),
    questionsWithEmail: sum(counted, business => business.enquiries?.withEmail),
    scans, scansDone: sum(counted, business => business.scans?.done), scansFailed: sum(counted, business => business.scans?.failed),
    aiCost: SCAN_COST.map(cost => scans * cost),
  }

  const funnels = {
    accounts: [
      { key: 'asked', label: 'Asked for a sign-in code', count: realAccounts.length },
      { key: 'signedIn', label: 'Signed in', count: signedIn.length },
      { key: 'website', label: 'Added a website', count: count(signedIn, account => account.businesses.some(business => business.plan !== 'internal')) },
    ],
    businesses: STEPS.map((step, index) => ({ key: step.key, label: step.label, count: count(counted, business => business.progress.done > index) })),
  }

  const pipeline = {
    trial: counted.filter(business => ['trial', 'ending'].includes(business.stage.key)).sort((a, b) => a.stage.daysLeft - b.stage.daysLeft),
    ended: at('ended').sort((a, b) => a.stage.daysAgo - b.stage.daysAgo),
  }

  // Week by week: the database's counts, with sign-ins and the running total
  // of businesses added here. Answers read and chats in use count from the day
  // counting began (trackingSince); weeks before it are marked untracked.
  const tracked = mondayOf(data?.trackingSince)
  const days = counted.map(business => sydneyDay(business.createdAt)).filter(Boolean)
  const weeks = (data?.weeks || []).map(week => ({
    ...week,
    signIns: count(signedIn, account => mondayOf(sydneyDay(account.createdAt)) === week.week),
    businessesTotal: days.filter(day => day < addDays(week.week, 7)).length,
    tracked: Boolean(tracked && week.week >= tracked),
  }))
  const months = (data?.months || []).map(month => ({ ...month, mrr: month.paying * PRICE }))

  return { now, businesses, counted, accounts, realAccounts, totals, funnels, pipeline, weeks, months,
    delivery: data?.delivery || { sent: 0, pending: 0, failed: 0 }, trackingSince: data?.trackingSince || null }
}

// ---- To take away ----------------------------------------------------------------

// A spreadsheet cell. One a spreadsheet would run as a formula (starting =, +,
// -, @, a tab or a return) starts with an apostrophe instead: business names
// and websites are typed by anyone who signs up.
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
export const toCsv = rows => `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`

export const CSV_COLUMNS = Object.freeze(['Business', 'Website', 'Owner email', 'Owner signed up', 'Owner last signed in', 'Website added',
  'Plan', 'Free trial', 'Trial ends', 'Steps done (of 6)', 'Next step', 'Website proved', 'Chat last seen', 'Answers approved', 'Drafts',
  'Answers read (all time)', 'Answers read (7 days)', 'Customer questions', 'Customer questions (30 days)', 'Scans'])

export function businessesCsv(summary) {
  const owners = new Map(summary.accounts.map(account => [account.id, account]))
  return toCsv([CSV_COLUMNS, ...summary.businesses.map(business => {
    const owner = owners.get(business.ownerId)
    return [business.name, business.website, owner?.email || '', sydneyDay(owner?.createdAt) || '', sydneyDay(owner?.lastSignInAt) || '',
      sydneyDay(business.createdAt) || '', business.plan, business.stage.label, sydneyDay(business.stage.endsAt) || '',
      business.progress.done, business.progress.next?.todo || 'all done', sydneyDay(business.websiteVerifiedAt) || '',
      sydneyDay(business.buttonSeenAt) || '', business.answers?.approved || 0, business.answers?.drafts || 0, business.answers?.read || 0,
      business.activity?.read7 || 0, business.enquiries?.total || 0, business.enquiries?.last30 || 0, business.scans?.total || 0]
  })])
}

// The numbers in a few lines, to paste into an investor update.
export function investorSummary(summary) {
  const t = summary.totals
  const read = t.answersRead7 ? ` (${number(t.answersRead7)} in the last 7 days)` : ''
  return [
    `SayGday at ${dateLabel(summary.now)}`,
    `Businesses: ${number(t.businesses)} (${number(t.businesses30)} new in the last 30 days)`,
    `Sign-ins: ${number(t.signIns)} (${number(t.signIns30)} new in the last 30 days)`,
    `Chats live on a website this week: ${number(t.live7)} (${number(t.proved)} websites proved)`,
    `Paying: ${number(t.paying)} · MRR ${dollars(t.mrr)} · ARR ${dollars(t.arr)}`,
    `In free trial: ${number(t.inTrial)} · trial over, not yet paying: ${number(t.trialEnded)}`,
    `Trial to paid: ${percent(t.trialToPaid)} (${number(t.paying)} of ${number(t.trialFinished)} businesses whose free ${TRIAL_DAYS} days are over, or that already pay)`,
    `Answers read by customers: ${number(t.answersRead)} all time${read}`,
    `Customer questions passed on: ${number(t.questions30)} in the last 30 days`,
    `Website scans: ${number(t.scans)} · AI cost about ${dollars(t.aiCost[0], { cents: true })}–${dollars(t.aiCost[1], { cents: true })}`,
  ].join('\n')
}

