// SayGday's own admin page (/admin): who has signed up, where each business is
// in its free 14 days, and the numbers an investor asks for (owner, 5 October
// 2026: "I'm unable to see anything about anyone… add extra that you feel
// would be needed in order to provide insights into future VCs").
//
// One password, set in Netlify as SAYGDAY_ADMIN_PASSWORD (twelve characters or
// more; without it the page stays switched off). The server checks it in
// constant time, at most ten tries an hour from one connection and fifty an
// hour in all, and answers the right one with a signed session cookie that
// lasts twelve hours: HttpOnly, Secure, SameSite=Strict, and sent only to
// /api/admin. Changing the password signs everyone out. A request made by
// any other website's page is refused before anything else.
//
// The page sees every sign-in and every business, but never a customer's
// question or email address: for those it sees when one came in and whether
// the email reached the business (the privacy page: "For your customers'
// questions, we act on your behalf").
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError, call, env, rateLimit } from './runtime.mjs'

export const ADMIN_ACTIONS = Object.freeze(['session', 'signIn', 'signOut', 'overview', 'business', 'setPlan'])
export const PLANS = Object.freeze(['trial', 'paying', 'cancelled', 'internal'])
export const ADMIN_COOKIE = 'saygday-admin'
export const MIN_PASSWORD_LENGTH = 12
export const SESSION_SECONDS = 12 * 60 * 60

export function adminConfiguration(read = env) {
  const password = String(read('SAYGDAY_ADMIN_PASSWORD') ?? '').trim()
  const serviceKey = String(read('SAYGDAY_SUPABASE_SERVICE_ROLE_KEY') ?? '').trim()
  return {
    password,
    ready: password.length >= MIN_PASSWORD_LENGTH,
    // Signs the session cookie: it changes with the password (and the
    // database key), and can't be worked out from outside.
    key: createHash('sha256').update(`saygday-admin-session:${serviceKey}:${password}`).digest(),
  }
}

// Constant time, whatever the two lengths.
const digest = value => createHash('sha256').update(String(value)).digest()
export const samePassword = (given, expected) => timingSafeEqual(digest(given), digest(expected))

const signature = (key, expires) => createHmac('sha256', key).update(`saygday-admin:${expires}`).digest('base64url')
export function sessionToken(configuration, now = Date.now()) {
  const expires = now + SESSION_SECONDS * 1000
  return `${expires}.${signature(configuration.key, expires)}`
}
// Five minutes' grace for one server's clock running behind another's.
export function validSession(configuration, token, now = Date.now()) {
  const match = /^(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(String(token ?? ''))
  if (!match || !configuration.ready) return false
  const expires = Number(match[1])
  if (!(expires > now) || expires > now + SESSION_SECONDS * 1000 + 300000) return false
  return timingSafeEqual(Buffer.from(match[2]), Buffer.from(signature(configuration.key, expires)))
}

export function readCookie(request, name = ADMIN_COOKIE) {
  for (const part of String(request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return null
}
export const sessionCookie = (token, maxAge) => `${ADMIN_COOKIE}=${token}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`

// Only the admin page itself, on SayGday's own address, may ask: the browser
// says where a request came from, and another website's page or form is
// refused. (The request must also be JSON, which no plain form can send.)
export function fromAdminPage(request) {
  const origin = request.headers.get('origin')
  if (origin) {
    let host = null
    try { host = new URL(origin).host } catch { /* not an address */ }
    if (host !== new URL(request.url).host) return false
  }
  const site = request.headers.get('sec-fetch-site')
  return !site || site === 'same-origin'
}

const accountJson = user => ({
  id: user.id, email: user.email || null, createdAt: user.created_at || null,
  lastSignInAt: user.last_sign_in_at || null, confirmed: Boolean(user.email_confirmed_at),
})

// Every sign-in, from Supabase Auth: the server's database role can't read
// the sign-ins table itself. A thousand a page.
export async function listAccounts(db) {
  const accounts = new Map()
  for (let page = 1; page <= 100; page++) {
    let result = null
    try { result = await db.auth.admin.listUsers({ page, perPage: 1000 }) } catch { /* below */ }
    if (!result || result.error) throw new HttpError(503, 'We couldn’t read the sign-ins just now. Please try again.', 'AUTH_UNAVAILABLE')
    const users = Array.isArray(result.data?.users) ? result.data.users : []
    for (const user of users) if (user?.id) accounts.set(user.id, accountJson(user))
    const total = Number(result.data?.total) || 0
    if (!users.length || (total ? accounts.size >= total : users.length < 1000)) break
  }
  return [...accounts.values()]
}

async function account(db, userId) {
  try {
    const result = await db.auth.admin.getUserById(userId)
    return result?.data?.user && !result.error ? accountJson(result.data.user) : null
  } catch { return null }
}

const id = value => {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400, 'That wasn’t found. Refresh and try again.', 'INVALID_ID')
  return value
}

// The admin page's own words for a database that hasn't had this update yet.
const adminCall = (db, name, args) => call(db, name, args).catch(error => {
  if (error.code === 'DATABASE_UPDATING') throw new HttpError(503, 'The database needs its latest update: run supabase/migrations/20261005100000_admin_dashboard.sql in Supabase’s SQL editor.', 'DATABASE_UPDATING')
  throw error
})

// Returns { result, cookie }: the reply, and the cookie to set with it.
export async function adminAction({ request, db, body, ip, configuration = adminConfiguration(), now = Date.now() }) {
  if (!fromAdminPage(request)) throw new HttpError(403, 'Open the admin page on SayGday itself.', 'CROSS_SITE')
  const action = body.action
  if (!ADMIN_ACTIONS.includes(action)) throw new HttpError(400, 'That action isn’t available.', 'UNKNOWN_ACTION')
  if (!configuration.password) throw new HttpError(503, 'The admin page is switched off. Set SAYGDAY_ADMIN_PASSWORD in Netlify, then deploy again.', 'ADMIN_NOT_CONFIGURED')
  if (!configuration.ready) throw new HttpError(503, `The admin password needs at least ${MIN_PASSWORD_LENGTH} characters. Set a longer SAYGDAY_ADMIN_PASSWORD in Netlify, then deploy again.`, 'ADMIN_PASSWORD_TOO_SHORT')

  if (action === 'signOut') return { result: { signedIn: false }, cookie: sessionCookie('', 0) }
  if (action === 'signIn') {
    await rateLimit(db, 'admin-sign-in', ip, 10, 3600)
    await rateLimit(db, 'admin-sign-in-all', 'admin', 50, 3600)
    const password = typeof body.password === 'string' ? body.password.trim() : ''
    if (!password || password.length > 500 || !samePassword(password, configuration.password)) {
      console.error('Admin sign-in refused')
      throw new HttpError(401, 'That password isn’t right.', 'WRONG_PASSWORD')
    }
    return { result: { signedIn: true }, cookie: sessionCookie(sessionToken(configuration, now), SESSION_SECONDS) }
  }

  const signedIn = validSession(configuration, readCookie(request), now)
  if (action === 'session') return { result: { signedIn } }
  if (!signedIn) throw new HttpError(401, 'Enter the admin password to continue.', 'ADMIN_SIGN_IN')
  await rateLimit(db, 'admin', ip, 120, 60)
  switch (action) {
    case 'overview': {
      const [accounts, businesses, trends] = await Promise.all([
        listAccounts(db), adminCall(db, 'admin_businesses', {}), adminCall(db, 'admin_trends', { p_weeks: 12, p_months: 12 }),
      ])
      return { result: { generatedAt: new Date(now).toISOString(), accounts, businesses, ...trends } }
    }
    case 'business': {
      const detail = await adminCall(db, 'admin_business', { p_business: id(body.business) })
      return { result: { ...detail, owner: await account(db, detail.business.ownerId) } }
    }
    case 'setPlan': {
      if (!PLANS.includes(body.plan)) throw new HttpError(400, 'Choose one of the plans on the list.', 'INVALID')
      return { result: { business: await adminCall(db, 'admin_set_plan', { p_business: id(body.business), p_plan: body.plan }) } }
    }
  }
}
