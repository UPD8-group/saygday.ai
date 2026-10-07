import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { Button, Icon, Logo, Notice, Spinner, when } from '../app/ui.jsx'
import { adminRequest } from './api.js'
import { summarise } from './metrics.mjs'
import Overview from './Overview.jsx'
import { Businesses, SignIns } from './Businesses.jsx'
import BusinessDetail from './BusinessDetail.jsx'

// SayGday's own admin page (/admin): every sign-in and business, where each
// is in its free 14 days, and the numbers an investor asks for. Behind one
// password, checked by the server (netlify/functions/_lib/admin.mjs).
const Admin = createContext(null)
export const useAdmin = () => useContext(Admin)

export default function AdminApp() {
  const [gate, setGate] = useState({ checking: true, signedIn: false, error: '', off: false })
  useEffect(() => {
    let alive = true
    adminRequest('session')
      .then(({ signedIn }) => { if (alive) setGate({ checking: false, signedIn, error: '', off: false }) })
      .catch(error => { if (alive) setGate({ checking: false, signedIn: false, error: error.message, off: /^ADMIN_/.test(error.code || '') }) })
    return () => { alive = false }
  }, [])
  const signedOut = useCallback(message => setGate({ checking: false, signedIn: false, error: message || '', off: false }), [])
  const signedIn = useCallback(() => setGate({ checking: false, signedIn: true, error: '', off: false }), [])
  if (gate.checking) return <div className="page"><Spinner label="Opening the admin page…" /></div>
  if (!gate.signedIn) return <SignIn gate={gate} onSignedIn={signedIn} />
  return <AdminData onSignedOut={signedOut}><Shell /></AdminData>
}

function SignIn({ gate, onSignedIn }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(gate.off ? '' : gate.error)
  useEffect(() => { document.title = 'Admin · SayGday' }, [])
  async function submit(event) {
    event.preventDefault()
    if (!password.trim()) { setError('Enter the admin password.'); return }
    setBusy(true); setError('')
    try { await adminRequest('signIn', { password }); onSignedIn() }
    catch (failure) { setError(failure.message); setBusy(false) }
  }
  return <div className="page admin">
    <header className="topbar"><Logo /><span className="admin-tag">Admin</span></header>
    <main className="container">
      <form className="card admin-gate" onSubmit={submit}>
        <span className="auth-card__icon"><Icon name="shield" size={28} /></span>
        <h1>SayGday admin</h1>
        {gate.off ? <Notice kind="error">{gate.error}</Notice> : <>
          <p className="lead">Every business on SayGday, where each one is in its free 14 days, and how it’s all going.</p>
          <Notice kind="error">{error}</Notice>
          <div className="field">
            <label htmlFor="admin-password">Admin password</label>
            <input id="admin-password" className="input" type="password" autoComplete="current-password" value={password}
              onChange={event => setPassword(event.target.value)} disabled={busy} autoFocus aria-invalid={Boolean(error)} />
          </div>
          <Button type="submit" size="big" busy={busy} iconAfter="arrow">{busy ? 'Checking…' : 'Open the admin page'}</Button>
        </>}
      </form>
    </main>
  </div>
}

function AdminData({ children, onSignedOut }) {
  const [state, setState] = useState({ loading: true, refreshing: false, error: '', data: null, loadedAt: 0 })
  // Any request the server says needs the password again goes back to it.
  const request = useCallback(async (action, params, options) => {
    try { return await adminRequest(action, params, options) }
    catch (error) {
      if (error.status === 401) onSignedOut('Your admin session has ended (they last twelve hours). Enter the password again.')
      throw error
    }
  }, [onSignedOut])
  const load = useCallback(async () => {
    setState(previous => ({ ...previous, refreshing: Boolean(previous.data), error: '' }))
    try {
      const data = await request('overview')
      setState({ loading: false, refreshing: false, error: '', data, loadedAt: Date.now() })
    } catch (error) {
      if (error.name !== 'AbortError') setState(previous => ({ ...previous, loading: false, refreshing: false, error: error.message }))
    }
  }, [request])
  useEffect(() => { load() }, [load])
  const summary = useMemo(() => (state.data ? summarise(state.data) : null), [state.data])
  const signOut = useCallback(async () => {
    try { await adminRequest('signOut') } catch { /* the cookie lapses by itself */ }
    onSignedOut('')
  }, [onSignedOut])
  return <Admin.Provider value={{ ...state, summary, reload: load, request, signOut }}>{children}</Admin.Provider>
}

function Shell() {
  const admin = useAdmin()
  // "Updated 3 minutes ago" keeps time without a refresh.
  const [, tick] = useState(0)
  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 60000); return () => clearInterval(timer) }, [])
  const counts = admin.summary && { businesses: admin.summary.businesses.length, signIns: admin.summary.accounts.length }
  return <div className="page admin">
    <header className="topbar">
      <Link to="/admin" className="topbar__home" aria-label="Admin overview"><Logo /></Link>
      <span className="admin-tag">Admin</span>
      <span className="admin-bar">
        {admin.loadedAt > 0 && <span className="admin-bar__when">Updated {when(new Date(admin.loadedAt).toISOString())}</span>}
        <Button kind="ghost" size="small" icon="refresh" onClick={admin.reload} busy={admin.refreshing}>Refresh</Button>
        <button type="button" className="text-button" onClick={admin.signOut}>Sign out</button>
      </span>
    </header>
    <nav className="tabs admin-tabs" aria-label="Admin">
      <NavLink end to="/admin"><Icon name="chart" size={18} />Overview</NavLink>
      <NavLink to="/admin/businesses"><Icon name="list" size={18} />Businesses{counts && <span className="badge badge--quiet">{counts.businesses}</span>}</NavLink>
      <NavLink to="/admin/sign-ins"><Icon name="users" size={18} />Sign-ins{counts && <span className="badge badge--quiet">{counts.signIns}</span>}</NavLink>
    </nav>
    <main className={`container admin-main${admin.refreshing ? ' is-refreshing' : ''}`}>
      {admin.loading ? <Spinner label="Counting everything…" />
        : !admin.summary ? <div className="card"><Notice kind="error">{admin.error}</Notice><Button onClick={admin.reload} icon="refresh">Try again</Button></div>
        : <>
          <Notice kind="error">{admin.error}</Notice>
          <Routes>
            <Route path="/admin" element={<Overview />} />
            <Route path="/admin/businesses" element={<Businesses />} />
            <Route path="/admin/businesses/:id" element={<BusinessDetail />} />
            <Route path="/admin/sign-ins" element={<SignIns />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </>}
    </main>
  </div>
}
