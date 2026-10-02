export class RequestTimeoutError extends Error {
  constructor(message = 'This is taking longer than expected. Check your connection and try again.') {
    super(message)
    this.name = 'RequestTimeoutError'
    this.code = 'REQUEST_TIMEOUT'
    this.status = 0
  }
}

export function checkAborted(signal) {
  if (!signal?.aborted) return
  if (signal.reason instanceof RequestTimeoutError) throw signal.reason
  throw new DOMException('The request was cancelled.', 'AbortError')
}

// A deadline covers the whole operation, including SDK locks and response bodies.
// Promise.race alone cannot cancel a fetch; pass this signal to the transport too.
export async function withDeadline(operation, { signal, timeoutMs = 35000, message } = {}) {
  checkAborted(signal)
  const controller = new AbortController()
  const cancel = () => controller.abort(new DOMException('The request was cancelled.', 'AbortError'))
  signal?.addEventListener('abort', cancel, { once: true })
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120000) : 35000
  const timer = setTimeout(() => controller.abort(new RequestTimeoutError(message)), duration)
  let onAbort
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      try { checkAborted(controller.signal) } catch (error) { reject(error) }
    }
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([
      Promise.resolve().then(() => { checkAborted(controller.signal); return operation(controller.signal) }),
      cancelled,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}

// Supabase consumes JSON after fetch resolves. Buffer its small auth response
// inside the deadline so a stalled body cannot leave login/sign-out pending.
export function authFetch(input, init = {}) {
  return withDeadline(async signal => {
    const response = await fetch(input, { ...init, signal })
    const body = await response.arrayBuffer()
    checkAborted(signal)
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    })
  }, { signal: init.signal || input?.signal, timeoutMs: 12000 })
}

// Keep the revision outside React renders: an auth event must invalidate old
// requests immediately, even before React has rendered the new session.
export function createSessionLifecycle() {
  let revision = 0
  let session = null
  const listeners = new Set()
  const identity = value => value?.user?.id || value?.access_token || null
  const invalidateRequests = () => { for (const listener of listeners) listener() }
  return {
    version: () => revision,
    isCurrent: version => version === revision,
    session: () => session,
    update(next) {
      const changedAccount = identity(next) !== identity(session)
      session = next; revision += 1
      if (changedAccount) invalidateRequests()
    },
    invalidate() { revision += 1; invalidateRequests() },
    onIdentityChange(listener) { listeners.add(listener); return () => listeners.delete(listener) },
  }
}

export async function requestForSession(lifecycle, operation, onUnauthorized, { signal } = {}) {
  checkAborted(signal)
  const version = lifecycle.version()
  const controller = new AbortController()
  const cancel = () => controller.abort()
  const unsubscribe = lifecycle.onIdentityChange(cancel)
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await operation({ signal: controller.signal })
    checkAborted(controller.signal)
    return result
  }
  catch (error) {
    checkAborted(controller.signal)
    if (error.status === 401 && lifecycle.isCurrent(version)) await onUnauthorized()
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
    unsubscribe()
  }
}
