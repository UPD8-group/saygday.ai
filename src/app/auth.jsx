import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { appRequest } from './api.js'
import { authFetch, createSessionLifecycle, requestForSession, withDeadline } from './request-lifecycle.js'

// Sign-in is Supabase's email code (carried over from the earlier platform's
// AuthContext): no passwords. A bad deployment setting fails closed.
const storageKey = 'saygday-auth'
const url = import.meta.env.VITE_SAYGDAY_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY
let client = null
try {
  if (url && publishableKey) client = createClient(url, publishableKey, {
    auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: authFetch },
  })
} catch { client = null }

const Auth = createContext(null)
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(Boolean(client))
  const [authError, setAuthError] = useState('')
  const lifecycle = useRef(createSessionLifecycle()).current
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (!client) return () => { mounted.current = false }
    const { data: subscription } = client.auth.onAuthStateChange((_event, next) => {
      if (!mounted.current) return
      lifecycle.update(next); setSession(next); setLoading(false)
      if (next) setAuthError('')
    })
    withDeadline(() => client.auth.getSession(), { timeoutMs: 15000 })
      .then(({ data }) => { if (!mounted.current) return; lifecycle.update(data?.session || null); setSession(data?.session || null) })
      .catch(() => { if (mounted.current) setAuthError('We couldn’t check your saved sign-in. Request a fresh email code below.') })
      .finally(() => { if (mounted.current) setLoading(false) })
    return () => { mounted.current = false; lifecycle.invalidate(); subscription.subscription.unsubscribe() }
  }, [lifecycle])

  const signOut = useCallback(async () => {
    lifecycle.update(null); setSession(null)
    try { if (client) await client.auth.signOut({ scope: 'local' }) } catch { /* local sign-out still happened */ }
    try { localStorage.removeItem(storageKey) } catch { /* private browsing */ }
  }, [lifecycle])

  const request = useCallback((action, params, options) => requestForSession(lifecycle,
    ({ signal }) => appRequest(client, action, params, { ...options, signal }),
    async () => { await signOut(); if (mounted.current) setAuthError('Your session has expired. Please sign in again.') }, options), [lifecycle, signOut])

  return <Auth.Provider value={{ client, configured: Boolean(client), loading, session, user: session?.user || null, authError, setAuthError, request, signOut }}>{children}</Auth.Provider>
}

export function useAuth() {
  const value = useContext(Auth)
  if (!value) throw new Error('useAuth must be inside AuthProvider')
  return value
}
