import { checkAborted, withDeadline } from '../app/request-lifecycle.js'

export class AdminError extends Error {
  constructor(message, code, status) { super(message); this.name = 'AdminError'; this.code = code; this.status = status }
}

// Every admin request goes to /api/admin (netlify/functions/_lib/admin.mjs).
// The page never holds the password: the server answers the right one with a
// cookie this page can't read, which the browser sends back to /api/admin
// alone.
export function adminRequest(action, params = {}, { signal, timeoutMs = 45000 } = {}) {
  return withDeadline(async requestSignal => {
    let response
    try {
      response = await fetch('/api/admin', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', signal: requestSignal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, action }),
      })
    } catch (error) {
      checkAborted(requestSignal)
      if (error.name === 'AbortError') throw error
      throw new AdminError('We couldn’t reach SayGday. Check your connection and try again.', 'NETWORK_ERROR', 0)
    }
    const body = await response.json().catch(() => null)
    checkAborted(requestSignal)
    if (!response.ok) throw new AdminError(body?.error || 'That didn’t work. Please try again.', body?.code || 'REQUEST_FAILED', response.status)
    return body
  }, { signal, timeoutMs, message: 'That’s taking longer than expected. Check your connection and try again.' })
}
