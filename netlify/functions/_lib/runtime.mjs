import { createHash, createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code }
}

export function env(name) {
  if (typeof Netlify !== 'undefined') return Netlify.env.get(name)
  return process.env[name]
}

const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
export function json(status, body, headers = {}) {
  return Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...headers } })
}

// Never return database errors, keys, provider replies or customer content.
export function errorResponse(error) {
  if (error instanceof HttpError) return json(error.status, { error: error.message, code: error.code })
  console.error('Unexpected error', error?.name || 'Error')
  return json(500, { error: 'We couldn’t complete that just now. Please try again.', code: 'INTERNAL_ERROR' })
}

export async function readJson(request, max = 32768) {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Send JSON for this request.', 'INVALID_CONTENT_TYPE')
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'That request is too large.', 'BODY_TOO_LARGE')
  const text = await request.text()
  if (Buffer.byteLength(text) > max) throw new HttpError(413, 'That request is too large.', 'BODY_TOO_LARGE')
  try {
    const data = JSON.parse(text)
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('not an object')
    return data
  } catch { throw new HttpError(400, 'That request could not be read.', 'INVALID_JSON') }
}

export function createServiceClient(read = env) {
  const url = read('SAYGDAY_SUPABASE_URL'), key = read('SAYGDAY_SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new HttpError(503, 'SayGday is still being connected. Please try again soon.', 'NOT_CONFIGURED')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

// The signed-in person, from the bearer token the dashboard sends. Only a
// confirmed email account counts.
export async function requireUser(request, db) {
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.headers.get('authorization') || '')
  if (!match) throw new HttpError(401, 'Please sign in to continue.', 'AUTH_REQUIRED')
  let result
  try { result = await db.auth.getUser(match[1]) } catch { throw new HttpError(503, 'We couldn’t check your sign-in. Please try again.', 'AUTH_UNAVAILABLE') }
  const user = result?.data?.user
  if (result?.error || !user?.id || !user.email || !user.email_confirmed_at) throw new HttpError(401, 'Please sign in again with your email code.', 'SESSION_EXPIRED')
  return user
}

// What each database refusal means to a person.
const REFUSALS = {
  NO_BUSINESS: [409, 'Add your website first.'],
  NOT_FOUND: [404, 'That wasn’t found. Refresh and try again.'],
  INVALID_WEBSITE: [400, 'Enter your website’s address, like https://yourbusiness.com.au'],
  SCAN_LIMIT: [429, 'That’s the most website scans for today. Please try again tomorrow.'],
  FAQ_LIMIT: [409, 'You’ve reached 200 questions. Remove one to add another.'],
  FEATURED_LIMIT: [409, 'Up to six questions can show when the chat opens. Turn one off first.'],
  FEATURE_NEEDS_APPROVAL: [409, 'Approve this answer before showing it when the chat opens.'],
  INVALID_STATUS: [400, 'That change isn’t available.'],
  SLUG_UNAVAILABLE: [503, 'We couldn’t set up your business just now. Please try again.'],
}
export function rpcResult({ data, error }) {
  if (!error) return data
  const code = /^[A-Z_]+$/.test(error.message || '') ? error.message : null
  if (code && REFUSALS[code]) throw new HttpError(REFUSALS[code][0], REFUSALS[code][1], code)
  if (error.code === '23505') throw new HttpError(409, 'You already have that question. Edit the existing one instead.', 'DUPLICATE')
  if (['23514', '22001', '22023', '22P02'].includes(error.code)) throw new HttpError(400, 'Some of those details aren’t valid. Check them and try again.', 'INVALID')
  throw new HttpError(503, 'We couldn’t reach your account just now. Please try again.', 'DATABASE_UNAVAILABLE')
}
export const call = async (db, name, args) => rpcResult(await db.rpc(name, args))

// Rate limits count requests by what they came from (a connection's internet
// address, an email address, an owner) without keeping it: the database only
// ever sees the kind of limit and a scrambled form of the subject, which can't
// be turned back into the address (the privacy page says so). Old rows are
// cleared by the database function itself.
const clean = value => String(value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim()
export function rateLimitSecret(read = env) {
  const own = clean(read('SAYGDAY_RATE_LIMIT_SECRET'))
  if (own) return own
  const serviceKey = clean(read('SAYGDAY_SUPABASE_SERVICE_ROLE_KEY'))
  // Without the database key nothing reaches the database anyway; this keeps
  // tests and local runs working.
  return createHash('sha256').update(`saygday-rate-limit:${serviceKey || 'local'}`).digest('hex')
}
export const rateLimitKey = (kind, subject, secret = rateLimitSecret()) =>
  `${kind}:${createHmac('sha256', secret).update(String(subject ?? 'unknown')).digest('base64url').slice(0, 32)}`

export async function rateLimit(db, kind, subject, limit, windowSeconds) {
  const allowed = await call(db, 'rate_limit', { p_key: rateLimitKey(kind, subject), p_limit: limit, p_window_seconds: windowSeconds })
  if (!allowed) throw new HttpError(429, windowSeconds >= 3600 ? 'A few too many requests. Please try again later.' : 'A few too many requests. Please wait a moment and try again.', 'RATE_LIMITED')
}
