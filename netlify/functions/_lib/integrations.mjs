import { createHash, randomBytes } from 'node:crypto'
import { HttpError, call, env, rateLimit, requireUser } from './runtime.mjs'

export const INTEGRATION_SCOPES = Object.freeze(['business:read', 'answers:read', 'answers:write', 'enquiries:read', 'enquiries:write'])
export const STUDIO_CALLBACK = 'https://oo.studio/dashboard/?saygday=callback'
const hash = value => createHash('sha256').update(value).digest('hex')
export const pkceChallenge = value => createHash('sha256').update(value).digest('base64url')
const invalid = () => new HttpError(400, 'Start the connection again from your oo.studio dashboard.', 'INVALID_CONNECTION')
const denied = () => new HttpError(401, 'Reconnect SayGday from your oo.studio dashboard.', 'INTEGRATION_EXPIRED')
const uuid = value => {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw invalid()
  return value
}

// An exact server-configured callback, never an arbitrary return URL. A
// preview only works when its own exact callback was explicitly configured.
export function allowedCallback(value, read = env) {
  const configured = read('SAYGDAY_STUDIO_CALLBACK_URL') || STUDIO_CALLBACK
  let parsed
  try { parsed = new URL(configured) } catch { throw invalid() }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || value !== configured) throw invalid()
  return configured
}

export function connectionRequest(body, read = env) {
  if (typeof body.state !== 'string' || typeof body.codeChallenge !== 'string'
    || !/^[A-Za-z0-9_-]{32,128}$/.test(body.state) || !/^[A-Za-z0-9_-]{43}$/.test(body.codeChallenge)) throw invalid()
  return { state: body.state, codeChallenge: body.codeChallenge, redirectUri: allowedCallback(body.redirectUri, read) }
}

function publicBusiness(b) {
  return Object.fromEntries(['id', 'slug', 'name', 'website', 'character', 'signedBy', 'greeting', 'buttonColour', 'websiteVerifiedAt', 'counts'].map(key => [key, b[key] ?? null]))
}

// Verify the owner on every delegated call. A deleted, banned, unconfirmed or
// transferred account cannot be kept alive by a previously issued grant.
async function activeOwner(db, ownerId) {
  let result
  try { result = await db.auth.admin.getUserById(ownerId) } catch { throw new HttpError(503, 'We couldn’t check this connection. Please try again.', 'AUTH_UNAVAILABLE') }
  const user = result?.data?.user
  if (result?.error || !user?.id || user.id !== ownerId || !user.email_confirmed_at || user.deleted_at
    || (user.banned_until && Date.parse(user.banned_until) > Date.now())) throw denied()
  return user
}

const limitedText = (value, min, max) => {
  if (value == null) return null
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(400, 'Check the question and answer lengths.', 'INVALID')
  return value.trim()
}

export async function integrationAction({ request, db, body, read = env, ip = 'unknown' }) {
  const action = body.action
  if (['authorize', 'connections', 'disconnect'].includes(action)) {
    const user = await requireUser(request, db)
    await activeOwner(db, user.id)
    await rateLimit(db, 'integration-owner', user.id, 30, 60)
    if (action === 'connections') return { connections: await call(db, 'integration_list', { p_user: user.id, p_business: uuid(body.business) }) }
    if (action === 'disconnect') return { revoked: await call(db, 'integration_revoke', { p_user: user.id, p_id: uuid(body.id) }) }
    const connection = connectionRequest(body, read)
    const code = randomBytes(32).toString('base64url')
    await call(db, 'integration_authorize', { p_user: user.id, p_business: uuid(body.business), p_code_hash: hash(code), p_challenge: connection.codeChallenge, p_redirect_uri: connection.redirectUri })
    const redirect = new URL(connection.redirectUri)
    redirect.searchParams.set('code', code); redirect.searchParams.set('state', connection.state)
    return { redirectUrl: redirect.href }
  }
  if (action === 'exchange') {
    await rateLimit(db, 'integration-exchange', ip, 30, 60)
    if (typeof body.code !== 'string' || typeof body.codeVerifier !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(body.code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.codeVerifier)) throw invalid()
    const redirectUri = allowedCallback(body.redirectUri, read)
    const accessToken = `sgp_${randomBytes(32).toString('base64url')}`
    const grant = await call(db, 'integration_exchange', { p_code_hash: hash(body.code), p_challenge: pkceChallenge(body.codeVerifier), p_redirect_uri: redirectUri, p_token_hash: hash(accessToken) })
    if (!grant) throw invalid()
    try { await activeOwner(db, grant.ownerId) } catch (error) {
      await call(db, 'integration_revoke', { p_user: grant.ownerId, p_id: grant.id }); throw error
    }
    const business = publicBusiness(await call(db, 'my_business', { p_user: grant.ownerId, p_business: grant.businessId }))
    return { accessToken, tokenType: 'Bearer', business, expiresAt: grant.expiresAt, scopes: INTEGRATION_SCOPES }
  }

  if (!['summary', 'listFaqs', 'saveFaq', 'listEnquiries', 'setEnquiry', 'revoke'].includes(action)) throw new HttpError(403, 'That action is not included in this connection.', 'SCOPE_DENIED')
  if (['business', 'businessId', 'owner', 'ownerId', 'user', 'userId', 'p_user', 'p_business'].some(key => key in body)) throw new HttpError(400, 'This connection already identifies the business.', 'BOUND_BUSINESS')
  const token = /^Bearer (sgp_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') || '')?.[1]
  if (!token) throw denied()
  const grant = await call(db, 'integration_resolve', { p_token_hash: hash(token) })
  if (!grant) throw denied()
  const execute = async (p_params = {}) => {
    const result = await call(db, 'integration_execute', { p_token_hash: hash(token), p_action: action, p_params })
    if (!result) throw denied()
    return result
  }
  // A valid connection can always disconnect itself without changing data.
  if (action === 'revoke') return execute()
  await activeOwner(db, grant.ownerId)
  await rateLimit(db, 'integration', grant.id, 120, 60)
  if (action === 'summary') { const result = await execute(); return { business: publicBusiness(result.business), scopes: INTEGRATION_SCOPES, expiresAt: result.expiresAt } }
  if (action === 'listFaqs') return execute()
  if (action === 'saveFaq') {
    const question = limitedText(body.question, 3, 200), answer = limitedText(body.answer, 1, 1500)
    if (!body.id && (!question || !answer)) throw new HttpError(400, 'Add a question and its answer.', 'INVALID')
    if (body.status !== undefined && !['draft', 'approved'].includes(body.status)) throw invalid()
    if (body.featured !== undefined && typeof body.featured !== 'boolean') throw invalid()
    if (body.variants != null && (!Array.isArray(body.variants) || body.variants.length > 12 || body.variants.some(value => typeof value !== 'string' || value.length > 200))) throw invalid()
    return execute({ id: body.id ? uuid(body.id) : null, question, answer,
      variants: body.variants?.map(value => value.trim()).filter(Boolean) ?? null, status: body.status ?? null, featured: body.featured ?? null })
  }
  if (!['new', 'done'].includes(body.status ?? 'new')) throw invalid()
  if (action === 'setEnquiry') {
    if (!['new','done'].includes(body.status)) throw invalid()
    return execute({ id: uuid(body.id), status: body.status })
  }
  const cursor = body.cursor
  if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor) || typeof cursor.createdAt !== 'string' || !Number.isFinite(Date.parse(cursor.createdAt)))) throw invalid()
  return execute({ status: body.status ?? 'new', before: cursor?.createdAt ?? null, beforeId: cursor ? uuid(cursor.id) : null })
}
