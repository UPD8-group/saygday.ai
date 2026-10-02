import { checkAborted, withDeadline } from './request-lifecycle.js'

export class AppError extends Error {
  constructor(message, code, status) { super(message); this.name = 'AppError'; this.code = code; this.status = status }
}

// Every dashboard request goes to /api/app with the person's sign-in. The
// browser never holds a database key or picks whose data it reads.
export function appRequest(client, action, params = {}, { signal, timeoutMs = 30000 } = {}) {
  if (!client) return Promise.reject(new AppError('SayGday is still being set up. Please try again soon.', 'SETUP_REQUIRED', 503))
  return withDeadline(async requestSignal => {
    let session
    try { session = (await client.auth.getSession()).data?.session } catch { checkAborted(requestSignal); throw new AppError('We couldn’t check your sign-in. Check your connection and try again.', 'SESSION_UNAVAILABLE', 503) }
    checkAborted(requestSignal)
    if (!session?.access_token) throw new AppError('Your session has expired. Please sign in again.', 'AUTH_REQUIRED', 401)
    let response
    try {
      response = await fetch('/api/app', {
        method: 'POST', cache: 'no-store', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...params, action }),
      })
    } catch (error) {
      checkAborted(requestSignal)
      if (error.name === 'AbortError') throw error
      throw new AppError('We couldn’t reach SayGday. Check your connection and try again.', 'NETWORK_ERROR', 0)
    }
    const body = await response.json().catch(() => null)
    checkAborted(requestSignal)
    if (!response.ok) throw new AppError(body?.error || 'That didn’t work. Please try again.', body?.code || 'REQUEST_FAILED', response.status)
    return body
  }, { signal, timeoutMs, message: 'That’s taking longer than expected. Check your connection and try again.' })
}
