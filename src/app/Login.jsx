import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { withDeadline } from './request-lifecycle.js'
import { cleanEmailCode, friendlyAuthError } from './login-helpers.js'
import { Button, Field, Icon, Logo, Notice, Spinner } from './ui.jsx'

// Sign in or sign up in one: an email address, then the code we email.
// No passwords. (The flow is the earlier platform's Login, simplified.)
export default function Login() {
  const { configured, loading, session, client, authError, setAuthError } = useAuth()
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const codeInput = useRef(null)
  useEffect(() => { document.title = 'Sign in · SayGday' }, [])
  useEffect(() => { if (!resendAt) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [resendAt])
  useEffect(() => { if (sentTo) codeInput.current?.focus() }, [sentTo])
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))

  if (!configured) return <Shell><div className="card auth-card"><h1>Almost ready</h1><p>SayGday is still being connected. Please check back soon.</p></div></Shell>
  if (loading) return <Shell><Spinner label="Checking your sign-in…" /></Shell>
  if (session) return <Navigate to="/app" replace />

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
    if (!/^\d{6,10}$/.test(code)) { setError('Enter the code from your email.'); return }
    setBusy(true); setError('')
    try {
      const { data, error: failure } = await withDeadline(() => client.auth.verifyOtp({ email: sentTo, token: code, type: 'email' }), { timeoutMs: 20000 })
      if (failure) throw failure
      if (!data?.session) throw new Error('No session')
    } catch (failure) { setError(friendlyAuthError(failure)); codeInput.current?.focus() }
    finally { setBusy(false) }
  }

  return <Shell>
    <div className="auth">
      <section className="auth__story">
        <p className="eyebrow">For Australian small businesses</p>
        <h1>Your website answers your customers’ questions.</h1>
        <p className="lead">We read your website and write the questions your customers ask. You check every answer. Then a friendly chat button on your site answers with your words, and passes anything else to you.</p>
        <ul className="auth__points">
          <li><Icon name="check" /> Only answers you’ve approved</li>
          <li><Icon name="check" /> No AI answering your customers</li>
          <li><Icon name="check" /> Questions it can’t answer come to your inbox</li>
        </ul>
      </section>
      <section className="card auth-card" aria-labelledby="auth-title">
        {sentTo ? <form onSubmit={verify}>
          <span className="auth-card__icon"><Icon name="mail" size={28} /></span>
          <h2 id="auth-title">Check your email</h2>
          <p>We sent a sign-in code to <strong>{sentTo}</strong>. Enter it here.</p>
          <Notice kind="error">{error || authError}</Notice>
          <Notice>{notice}</Notice>
          <Field label="Sign-in code">{(id, note) => <input ref={codeInput} id={id} aria-describedby={note} className="input input--code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={event => setCode(cleanEmailCode(event.target.value))} disabled={busy} />}</Field>
          <Button type="submit" size="big" busy={busy} disabled={code.length < 6} iconAfter="arrow">{busy ? 'Checking…' : 'Sign in'}</Button>
          <div className="auth-card__actions">
            <button type="button" className="text-button" disabled={busy || wait > 0} onClick={event => sendCode(event, true)}>{wait ? `Send a new code in ${wait}s` : 'Send a new code'}</button>
            <button type="button" className="text-button" disabled={busy} onClick={() => { setSentTo(''); setCode(''); setError(''); setNotice('') }}>Use another email</button>
          </div>
          <p className="small">Can’t see it? Check your spam folder for an email from SayGday.</p>
        </form> : <form onSubmit={sendCode}>
          <span className="auth-card__icon"><Icon name="shield" size={28} /></span>
          <h2 id="auth-title">Sign in or get started</h2>
          <p>Enter your email and we’ll send you a code. New here? We’ll set up your account. No password needed.</p>
          <Notice kind="error">{error || authError}</Notice>
          <Field label="Your email">{(id, note) => <input id={id} aria-describedby={note} className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@yourbusiness.com.au" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />}</Field>
          <Button type="submit" size="big" busy={busy} disabled={wait > 0} iconAfter="arrow">{busy ? 'Sending…' : wait ? `Try again in ${wait}s` : 'Email me a code'}</Button>
        </form>}
      </section>
    </div>
  </Shell>
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

function Shell({ children }) {
  return <div className="page page--auth"><header className="topbar"><Logo /></header><main className="container">{children}</main></div>
}
