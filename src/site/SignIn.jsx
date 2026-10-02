import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../app/auth.jsx'
import { withDeadline } from '../app/request-lifecycle.js'
import { cleanEmailCode, friendlyAuthError } from '../app/login-helpers.js'

// The card on /login: sign in or sign up in one, with an email address and
// then the code we email. No passwords. A signed-in owner goes straight to
// the dashboard (/app), which is its own page.
const SHIELD = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4.5" /></svg>
const MAIL = <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 6.5l8.5 6.5 8.5-6.5" /></svg>
const ARROW = <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 9h11m-4-4.5L14.5 9 10 13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>

const Icon = ({ children }) => <span className="login__icon" aria-hidden="true">{children}</span>

export default function SignIn({ initialEmail = '' }) {
  const { configured, session, client, authError, setAuthError } = useAuth()
  const [email, setEmail] = useState(initialEmail)
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const codeInput = useRef(null)
  useEffect(() => { if (session) window.location.replace('/app') }, [session])
  useEffect(() => { if (!resendAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [resendAt])
  useEffect(() => { if (sentTo) codeInput.current?.focus() }, [sentTo])
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const problem = error || authError

  if (!configured) return <div className="login__step"><Icon>{SHIELD}</Icon><h2>Almost ready</h2><p>SayGday is still being connected. Please check back soon.</p></div>
  if (session) return <div className="login__step"><Icon>{SHIELD}</Icon><h2>You’re signed in</h2><p className="login__wait">Opening your dashboard…</p></div>

  async function sendCode(event, again = false) {
    event?.preventDefault()
    if (busy || wait) return
    const address = (again ? sentTo : email).trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) { setError('Enter your email address, like you@yourbusiness.com.au'); return }
    setBusy(true); setError(''); setNotice(''); setAuthError('')
    try {
      await withDeadline(signal => requestCode(address, signal), { timeoutMs: 20000 })
      setSentTo(address); setCode(''); setResendAt(Date.now() + 60000); setNow(Date.now())
      setNotice(again ? 'A new code is on its way. Use the newest email.' : '')
    } catch (failure) {
      setError(failure?.friendly || friendlyAuthError(failure))
      if (failure?.status === 429) { setResendAt(Date.now() + 60000); setNow(Date.now()) }
    } finally { setBusy(false) }
  }

  async function verify(event) {
    event.preventDefault()
    if (busy) return
    if (!/^\d{6,10}$/.test(code)) { setError('Enter the code from your email.'); codeInput.current?.focus(); return }
    setBusy(true); setError('')
    try {
      const { data, error: failure } = await withDeadline(() => client.auth.verifyOtp({ email: sentTo, token: code, type: 'email' }), { timeoutMs: 20000 })
      if (failure) throw failure
      if (!data?.session) throw new Error('No session')
    } catch (failure) { setError(friendlyAuthError(failure)); codeInput.current?.focus() }
    finally { setBusy(false) }
  }

  if (sentTo) return <form className="login__step" onSubmit={verify} noValidate>
    <Icon>{MAIL}</Icon>
    <h2>Check your email</h2>
    <p>We sent a sign-in code to <strong>{sentTo}</strong>. Enter it here.</p>
    {notice && <p className="login__notice" role="status">{notice}</p>}
    <div className="login__field">
      <label htmlFor="login-digits">Sign-in code</label>
      <input ref={codeInput} id="login-digits" className="login__input login__input--code" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
        value={code} onChange={event => setCode(cleanEmailCode(event.target.value))} disabled={busy}
        aria-invalid={Boolean(problem)} aria-describedby={problem ? 'login-code-error' : undefined} />
      {problem && <p className="login__error" id="login-code-error" role="alert">{problem}</p>}
    </div>
    <button className="btn btn--green" type="submit" disabled={busy || code.length < 6}>{busy ? 'Checking…' : <>Sign in {ARROW}</>}</button>
    <div className="login__actions">
      <button className="text-btn" type="button" disabled={busy || wait > 0} onClick={event => sendCode(event, true)}>{wait ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
      <button className="text-btn" type="button" disabled={busy} onClick={() => { setSentTo(''); setCode(''); setError(''); setNotice('') }}>Use another email</button>
    </div>
    <p className="login__note">Can’t see it? Check your spam folder for an email from SayGday.</p>
  </form>

  return <form className="login__step" onSubmit={sendCode} noValidate>
    <Icon>{SHIELD}</Icon>
    <h2>Sign in or get started</h2>
    <p>We’ll email you a code. That’s it.</p>
    <div className="login__field">
      <label htmlFor="login-address">Your email</label>
      <input id="login-address" className="login__input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@yourbusiness.com.au"
        value={email} onChange={event => setEmail(event.target.value)} disabled={busy}
        aria-invalid={Boolean(problem)} aria-describedby={problem ? 'login-email-error' : undefined} />
      {problem && <p className="login__error" id="login-email-error" role="alert">{problem}</p>}
    </div>
    <button className="btn btn--green" type="submit" disabled={busy || wait > 0}>{busy ? 'Sending…' : wait ? `Try again in ${wait}s` : <>Email me a code {ARROW}</>}</button>
  </form>
}

// SayGday emails the code itself (netlify/functions/sign-in.mts), from the
// SayGday address. Supabase only makes the code and checks it.
async function requestCode(email, signal) {
  const response = await fetch('/api/sign-in', {
    method: 'POST', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (response.ok) return
  const body = await response.json().catch(() => null)
  throw Object.assign(new Error(body?.error || 'Sign-in code not sent'), { status: response.status, code: body?.code, friendly: body?.error })
}
