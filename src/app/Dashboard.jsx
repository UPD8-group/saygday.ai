import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { Button, Icon, Logo, Notice, Spinner, plural } from './ui.jsx'
import { Avatar } from '../chat/Chat.jsx'
import { BillingNotice } from './Billing.jsx'
import { billingView, UNAVAILABLE_BILLING } from './billing-view.mjs'

// The dashboard's shared state: the business, its latest website scan and its
// questions and answers. Every screen reads and refreshes it here.
const Dash = createContext(null)
export const useDash = () => useContext(Dash)
const SCANNING = ['queued', 'reading']

export function DashboardProvider({ children }) {
  const { request, session } = useAuth()
  const [state, setState] = useState({ loading: true, error: '', email: '', business: null, scan: null, billing: null })
  const [faqs, setFaqs] = useState(null)
  const [billingRefreshing, setBillingRefreshing] = useState(false)
  const [billingError, setBillingError] = useState('')
  const billingRequest = useRef(null)
  const refreshBilling = useCallback(() => {
    if (billingRequest.current) return billingRequest.current
    setBillingRefreshing(true); setBillingError('')
    billingRequest.current = (async () => {
      try {
        const result = await request('billingStatus')
        const billing = result?.billing || UNAVAILABLE_BILLING
        setState(current => ({ ...current, billing }))
        return billing
      } catch (error) {
        if (error.name !== 'AbortError') {
          setState(current => ({ ...current, billing: { ...UNAVAILABLE_BILLING, portalAvailable: current.billing?.portalAvailable === true } }))
          setBillingError(error.message)
        }
        return null
      } finally { billingRequest.current = null; setBillingRefreshing(false) }
    })()
    return billingRequest.current
  }, [request])
  const load = useCallback(async () => {
    try {
      const me = await request('me')
      setState({ loading: false, error: '', ...me, billing: me.billing || UNAVAILABLE_BILLING })
      if (me.business) setFaqs((await request('listFaqs')).faqs)
      return me
    } catch (error) {
      if (error.name !== 'AbortError') setState(current => ({ ...current, loading: false, error: error.message }))
      return null
    }
  }, [request])
  useEffect(() => { if (session) load() }, [session, load])
  useEffect(() => {
    if (!state.business) return
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') refreshBilling() }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible) }
  }, [Boolean(state.business), refreshBilling])
  useEffect(() => {
    // An open dashboard must recheck the server at a trial or paid-period
    // boundary instead of continuing to claim that yesterday's chat is live.
    const boundaries = [state.billing?.trialEndsAt, state.billing?.currentPeriodEnd].map(Date.parse).filter(value => Number.isFinite(value) && value > Date.now())
    if (!boundaries.length) return
    const timer = setTimeout(refreshBilling, Math.min(Math.max(1000, Math.min(...boundaries) - Date.now() + 1000), 2147483647))
    return () => clearTimeout(timer)
  }, [state.billing, refreshBilling])
  const value = { ...state, faqs, setFaqs, setBusiness: business => setState(current => ({ ...current, business })), setScan: scan => setState(current => ({ ...current, scan })), reload: load, request, refreshBilling, billingRefreshing, billingError }
  return <Dash.Provider value={value}>{children}</Dash.Provider>
}

export function RequireSignIn({ children }) {
  const { loading, session } = useAuth()
  if (loading) return <div className="page"><Spinner label="Checking your sign-in…" /></div>
  if (!session) return <GoToSignIn />
  return children
}

// Sign-in is its own page on the public website (site/login.html), not a
// screen of the dashboard, so getting there is a full page load.
export const goToSignIn = () => window.location.replace('/login')
function GoToSignIn() {
  useEffect(goToSignIn, [])
  return <div className="page"><Spinner label="Opening sign-in…" /></div>
}

export function Layout() {
  const { signOut } = useAuth()
  const dash = useDash()
  const ready = dash.business && !SCANNING.includes(dash.scan?.status)
  const drafts = dash.faqs?.filter(faq => faq.status === 'draft').length || 0
  const asked = dash.business?.counts?.newEnquiries || 0
  return <div className="page">
    <header className="topbar">
      <Link to="/app" className="topbar__home" aria-label="SayGday home"><Logo /></Link>
      {dash.business && <span className="topbar__business"><Avatar character={dash.business.character} size={28} />{dash.business.name}</span>}
      <button type="button" className="text-button topbar__out" onClick={async () => { await signOut(); goToSignIn() }}>Sign out</button>
    </header>
    {dash.business && <nav className="tabs" aria-label="Dashboard">
      <NavLink end to="/app"><Icon name="home" size={18} />Home</NavLink>
      {ready && <>
      <NavLink to="/app/questions"><Icon name="list" size={18} />Questions{drafts > 0 && <span className="badge">{drafts}</span>}</NavLink>
      <NavLink to="/app/asked"><Icon name="inbox" size={18} />Customers asked{asked > 0 && <span className="badge">{asked}</span>}</NavLink>
      <NavLink to="/app/button"><Icon name="chat" size={18} />Chat button</NavLink>
      </>}
      <NavLink to="/app/settings"><Icon name="settings" size={18} />Settings</NavLink>
    </nav>}
    <main className="container">
      {!dash.loading && dash.business && <BillingNotice billing={dash.billing} />}
      {dash.loading ? <Spinner label="Opening your dashboard…" /> : dash.error && !dash.business ? <div className="card"><Notice kind="error">{dash.error}</Notice><Button onClick={dash.reload} icon="refresh">Try again</Button></div> : <Outlet />}
    </main>
  </div>
}

// /app: the first screen (web address), the scan in progress, or home.
export function Home() {
  const dash = useDash()
  if (!dash.business) return <Start />
  if (SCANNING.includes(dash.scan?.status)) return <Scanning />
  return <Overview />
}

function Start() {
  const dash = useDash()
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { document.title = 'Get started · SayGday' }, [])
  async function submit(event) {
    event.preventDefault()
    if (!website.trim()) { setError('Enter your website’s address.'); return }
    setBusy(true); setError('')
    try {
      const result = await dash.request('createBusiness', { website })
      dash.setBusiness(result.business); dash.setScan(result.scan); dash.setFaqs([])
      await dash.refreshBilling()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <div className="start">
    <section className="hero card card--green">
      <p className="eyebrow">Step 1 of 3</p>
      <h1>Put your web address in.</h1>
      <p className="lead">We’ll read your website and write the 20 to 25 questions your customers ask most, with the answers from your own pages. You check every one before anything goes live.</p>
      <form className="hero__form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="website">Your website address</label>
        <div className="url-input"><span aria-hidden="true">https://</span><input id="website" value={website} onChange={event => setWebsite(event.target.value.replace(/^https?:\/\//i, ''))} placeholder="yourbusiness.com.au" autoComplete="url" autoCapitalize="none" spellCheck={false} inputMode="url" disabled={busy} aria-invalid={Boolean(error)} /></div>
        <Button type="submit" size="big" kind="gold" busy={busy} iconAfter="arrow">{busy ? 'Starting…' : 'Scan my website'}</Button>
      </form>
      {error && <p className="hero__error" role="alert">{error}</p>}
    </section>
    <ol className="steps">
      <li><span className="steps__icon"><Icon name="globe" size={30} /></span><strong>We read your website</strong><span>Your pages, menu, prices, hours and contact details. It takes a minute or two.</span></li>
      <li><span className="steps__icon"><Icon name="check" size={30} /></span><strong>You check the answers</strong><span>Approve, edit or remove each one. Add your own any time.</span></li>
      <li><span className="steps__icon"><Icon name="chat" size={30} /></span><strong>Add the chat to your site</strong><span>One line of code. Customers get your answers, in your words.</span></li>
    </ol>
  </div>
}

const STAGES = ['Finding your pages', 'Writing questions', 'Saving your questions']
function Scanning() {
  const dash = useDash()
  const timer = useRef(null)
  useEffect(() => { document.title = 'Reading your website · SayGday' }, [])
  useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const { scan } = await dash.request('scanStatus')
        if (!alive) return
        if (scan && !SCANNING.includes(scan.status)) { await dash.reload(); return }
        dash.setScan(scan)
      } catch { /* keep trying */ }
      if (alive) timer.current = setTimeout(poll, 3000)
    }
    timer.current = setTimeout(poll, 2500)
    return () => { alive = false; clearTimeout(timer.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const stage = dash.scan?.stage || 'Starting'
  const step = /saving/i.test(stage) ? 2 : /writing|reading \d|questions from/i.test(stage) ? 1 : 0
  return <section className="card scanning" aria-live="polite">
    <div className="scanning__art" aria-hidden="true"><span className="page-art" /><span className="page-art" /><span className="page-art" /><span className="scanning__lens"><Icon name="search" size={42} /></span></div>
    <h1>Reading {dash.business.website?.replace(/^https:\/\//, '')}</h1>
    <p className="lead">{stage}…</p>
    <ol className="progress">{STAGES.map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-now' : ''}><span>{index < step ? <Icon name="check" size={16} /> : index + 1}</span>{label}</li>)}</ol>
    <p className="small">This usually takes a minute or two. You can leave this page and come back. We’ll keep going.</p>
  </section>
}

function Overview() {
  const dash = useDash()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { business, scan } = dash
  const faqs = dash.faqs || []
  useEffect(() => { document.title = `${business.name} · SayGday` }, [business.name])
  const live = faqs.filter(faq => faq.status === 'approved').length
  const drafts = faqs.filter(faq => faq.status === 'draft').length
  const seen = Boolean(business.buttonSeenAt)
  // The chat only runs once the website is proved to be the business's own.
  const verified = Boolean(business.websiteVerifiedAt)
  const billing = billingView(dash.billing)
  const available = verified && billing.accessAllowed
  async function rescan() {
    setBusy(true); setError('')
    try { const result = await dash.request('startScan'); dash.setBusiness(result.business); dash.setScan(result.scan) }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const next = scan?.status === 'failed' && !faqs.length
    ? { tone: 'warn', title: 'We couldn’t read your website', text: scan.error || 'Please try again.', action: <><Button onClick={rescan} busy={busy} icon="refresh">Try again</Button><Button kind="ghost" onClick={() => navigate('/app/questions?add=1')} icon="plus">Add questions myself</Button></> }
    : drafts > 0 ? { tone: 'gold', title: `${plural(drafts, 'question')} ${drafts === 1 ? 'is' : 'are'} waiting for you to check`, text: 'Nothing goes on your website until you approve it. Edit anything that isn’t quite right.', action: <Button size="big" kind="gold" onClick={() => navigate('/app/questions')} iconAfter="arrow">Check them now</Button> }
    : !live ? { tone: 'gold', title: 'Add your first questions', text: 'Write the questions your customers ask, with your answers.', action: <Button size="big" kind="gold" onClick={() => navigate('/app/questions?add=1')} icon="plus">Add a question</Button> }
    : !verified ? { tone: 'gold', title: 'Put the chat button on your website', text: `${plural(live, 'answer')} ${live === 1 ? 'is' : 'are'} ready. Add one line to your website, then check that the website is yours. Billing in Settings shows whether your chat can run.`, action: <Button size="big" kind="gold" onClick={() => navigate('/app/button')} iconAfter="arrow">Show me how</Button> }
    : !billing.accessAllowed ? { tone: 'warn', title: billing.title, text: billing.description, action: <Button kind="dark" onClick={() => navigate('/app/settings#billing')} iconAfter="arrow">View billing</Button> }
    : !seen ? { tone: 'green', title: 'Your chat is switched on', text: `We checked ${business.website.replace(/^https:\/\//, '')} is yours. Your button shows the next time your website loads.`, action: null }
    : { tone: 'green', title: 'Your chat is live on your website', text: `Customers can see ${plural(live, 'answer')}. Questions it can’t answer come to Customers asked.`, action: null }
  return <div className="overview">
    <h1 className="greeting">G’day, {business.name}</h1>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <section className={`next card card--${next.tone}`}>
      <div><h2>{next.title}</h2><p>{next.text}</p></div>
      {next.action && <div className="next__actions">{next.action}</div>}
    </section>
    <div className="tiles">
      <Tile to="/app/questions" icon="list" title="Questions & answers" big={live} label={`${available ? 'live on your website' : 'approved answers saved'}${drafts ? ` · ${drafts} to check` : ''}`} />
      <Tile to="/app/asked" icon="inbox" title="Customers asked" big={business.counts?.newEnquiries || 0} label="new questions for you" />
      <Tile to="/app/button" icon="chat" title="Chat button" big={available ? 'Live' : verified ? 'Paused' : 'Not yet'} label={available ? 'on your website' : verified ? 'check your billing' : 'switched on'} />
      <Tile to="/app/questions?show=live" icon="eye" title="Answers read" big={business.counts?.views || 0} label="times by customers" />
    </div>
  </div>
}

function Tile({ to, icon, title, big, label }) {
  return <Link to={to} className="tile card">
    <span className="tile__icon"><Icon name={icon} size={26} /></span>
    <span className="tile__title">{title}</span>
    <span className="tile__big">{big}</span>
    <span className="tile__label">{label}</span>
    <Icon name="arrow" size={20} className="tile__go" />
  </Link>
}

// Billing remains reachable during a scan, including cancellation and payment
// recovery. The other screens still wait for the scan to finish.
export function RequireBusiness({ children, allowWhileScanning = false }) {
  const dash = useDash()
  if (!dash.business || (!allowWhileScanning && SCANNING.includes(dash.scan?.status))) return <Navigate to="/app" replace />
  return children
}
