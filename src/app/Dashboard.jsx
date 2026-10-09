import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { Button, Icon, Logo, Notice, Spinner, plural } from './ui.jsx'
import { Avatar } from '../chat/Chat.jsx'
import { BillingNotice } from './Billing.jsx'
import { billingView, UNAVAILABLE_BILLING } from './billing-view.mjs'
import { chatReviewKey, setupChecklist, setupPath } from './setup-flow.mjs'

// The dashboard's shared state: the sign-in's businesses, the one being worked
// on, its latest website scan and its questions and answers. Every screen
// reads and refreshes it here.
//
// ONE SIGN-IN, MANY BUSINESSES (owner, 4 October 2026): a studio that builds
// websites for its clients holds each client's chat under one sign-in. The
// business being worked on is remembered by slug (localStorage, and
// ?business= in the address, so a link opens the right one), and EVERY request
// names it, so two tabs on two businesses never edit each other's answers.
const Dash = createContext(null)
export const useDash = () => useContext(Dash)
const SCANNING = ['queued', 'reading']
const REMEMBER = 'saygday-business'
function rememberedSlug() {
  try {
    return new URLSearchParams(window.location.search).get('business') || localStorage.getItem(REMEMBER) || ''
  } catch { return '' }
}
function remember(slug) {
  try { if (slug) localStorage.setItem(REMEMBER, slug); else localStorage.removeItem(REMEMBER) } catch { /* private browsing */ }
}

export function DashboardProvider({ children }) {
  const { request: send, session } = useAuth()
  const [state, setState] = useState({ loading: true, error: '', email: '', businesses: [], business: null, scan: null, billing: null })
  const [faqs, setFaqs] = useState(null)
  const [reviewedChat, setReviewedChat] = useState('')
  const [confirmedAppearance, setConfirmedAppearance] = useState('')
  // The mounted appearance editor registers its save while it has pending edits.
  const appearanceSave = useRef(null)
  // The business every request names. A ref, so a request fired in the same
  // breath as a switch still names the right one.
  const current = useRef(null)
  const point = business => { current.current = business?.id || null; if (business) remember(business.slug) }
  const request = useCallback((action, params = {}, options) => send(action, { business: current.current, ...params }, options), [send])

  const [billingRefreshing, setBillingRefreshing] = useState(false)
  const [billingError, setBillingError] = useState('')
  const billingRequest = useRef(null)
  const selection = useRef(0)
  const refreshBilling = useCallback(() => {
    const business = current.current, version = selection.current
    if (!business) return Promise.resolve(null)
    if (billingRequest.current?.business === business && billingRequest.current.version === version) return billingRequest.current.promise
    setBillingRefreshing(true); setBillingError('')
    const task = { business, version }
    task.promise = (async () => {
      try {
        const result = await request('billingStatus')
        if (current.current !== business || selection.current !== version) return null
        const billing = result?.billing || UNAVAILABLE_BILLING
        setState(current => ({ ...current, billing }))
        return billing
      } catch (error) {
        if (current.current === business && selection.current === version && error.name !== 'AbortError') {
          setState(current => ({ ...current, billing: { ...UNAVAILABLE_BILLING, portalAvailable: current.billing?.portalAvailable === true } }))
          setBillingError(error.message)
        }
        return null
      } finally {
        if (billingRequest.current === task) { billingRequest.current = null; setBillingRefreshing(false) }
      }
    })()
    billingRequest.current = task
    return task.promise
  }, [request])

  // Make `business` the one being worked on: its scan, its answers.
  const open = useCallback(async (business, me = null) => {
    point(business)
    const version = ++selection.current
    billingRequest.current = null
    setBillingRefreshing(false); setBillingError('')
    setState(previous => ({ ...previous, business, billing: null, scan: null }))
    const scan = !business ? null : me?.business?.id === business.id ? me.scan : (await send('scanStatus', { business: business.id })).scan
    if (selection.current !== version) return
    setState(previous => ({ ...previous, loading: false, error: '', billing: me?.business?.id === business?.id ? me.billing : null, email: me?.email ?? previous.email, businesses: me?.businesses ?? previous.businesses, business, scan }))
    const questions = business ? (await send('listFaqs', { business: business.id })).faqs : null
    if (selection.current !== version) return
    setFaqs(questions)
    if (business) await refreshBilling()
  }, [send, refreshBilling])

  const load = useCallback(async () => {
    try {
      const me = await send('me')
      const wanted = rememberedSlug()
      await open(me.businesses.find(item => item.slug === wanted) || me.business || null, me)
      return me
    } catch (error) {
      if (error.name !== 'AbortError') setState(previous => ({ ...previous, loading: false, error: error.message }))
      return null
    }
  }, [send, open])
  useEffect(() => { if (session) load() }, [session, load])

  // Switch to another of the sign-in's businesses, by slug.
  const choose = useCallback(async slug => {
    const business = state.businesses.find(item => item.slug === slug)
    if (!business || business.id === current.current) return
    setFaqs(null)
    setState(previous => ({ ...previous, business, scan: null }))
    try { await open(business) } catch (error) { if (error.name !== 'AbortError') setState(previous => ({ ...previous, error: error.message })) }
  }, [state.businesses, open])

  // A business just added (or the first one): it joins the list and becomes
  // the one being worked on, with the scan that has just started.
  const added = useCallback((business, scan) => {
    point(business)
    ++selection.current
    billingRequest.current = null
    setBillingRefreshing(false); setBillingError('')
    setState(previous => ({ ...previous, business, scan, billing: null, businesses: previous.businesses.some(item => item.id === business.id)
      ? previous.businesses.map(item => item.id === business.id ? business : item) : [...previous.businesses, business] }))
    setFaqs([])
    refreshBilling()
  }, [refreshBilling])

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

  const setBusiness = business => setState(previous => ({ ...previous, business, businesses: previous.businesses.map(item => item.id === business.id ? business : item) }))
  const reviewKey = chatReviewKey(state.business, faqs)
  const previewApproved = Boolean(reviewKey && reviewedChat === reviewKey)
  const approveChatPreview = () => setReviewedChat(reviewKey)
  const appearanceConfirmed = previewApproved || Boolean(state.business && confirmedAppearance === chatReviewKey(state.business, []))
  const confirmChatAppearance = (business = state.business) => setConfirmedAppearance(chatReviewKey(business, []))
  const value = { ...state, appearanceSave, previewApproved, approveChatPreview, appearanceConfirmed, confirmChatAppearance, faqs, setFaqs, setBusiness, setScan: scan => setState(previous => ({ ...previous, scan })), reload: load, request, choose, added, refreshBilling, billingRefreshing, billingError }
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
  const navigate = useNavigate()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef(null)
  const main = useRef(null)
  const leavingAppearance = useRef(false)
  const [savingAppearance, setSavingAppearance] = useState(false)
  const ready = dash.business && !SCANNING.includes(dash.scan?.status)
  const drafts = dash.faqs?.filter(faq => faq.status === 'draft').length || 0
  const asked = dash.business?.counts?.newEnquiries || 0
  const checklist = setupChecklist(dash)
  const selectedStep = location.pathname.split('/')[3]
  useEffect(() => { setMenuOpen(false) }, [location.pathname, dash.business?.id])
  function closeMenu() { setMenuOpen(false); menuButton.current?.focus() }
  function followLink(event) {
    if (event.target.closest('a')) { setMenuOpen(false); requestAnimationFrame(() => main.current?.focus()) }
  }
  async function leaveAppearance(next) {
    if (leavingAppearance.current) return
    leavingAppearance.current = true
    setSavingAppearance(Boolean(dash.appearanceSave.current))
    try {
      if (dash.appearanceSave.current && !await dash.appearanceSave.current()) {
        setMenuOpen(false)
        requestAnimationFrame(() => main.current?.focus())
        return
      }
      await next()
    } finally { leavingAppearance.current = false; setSavingAppearance(false) }
  }
  function saveBeforeLink(event) {
    if (!dash.appearanceSave.current && !leavingAppearance.current) return
    const link = event.target.closest('a[href]')
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank' || link.hasAttribute('download')) return
    const destination = new URL(link.href, window.location.href)
    if (destination.origin !== window.location.origin || !destination.pathname.startsWith('/app') || link.getAttribute('href').startsWith('#')) return
    event.preventDefault()
    event.stopPropagation()
    leaveAppearance(() => {
      navigate(destination.pathname + destination.search + destination.hash)
      setMenuOpen(false)
      requestAnimationFrame(() => main.current?.focus())
    })
  }
  return <div className="page dashboard-shell" onClickCapture={saveBeforeLink}>
    <a className="skip-link" href="#dashboard-main">Skip to content</a>
    <header className="dashboard-mobile-bar">
      <Link to="/app" aria-label="SayGday home"><Logo small /></Link>
      <span>{dash.business?.name || 'Your workspace'}</span>
      <button type="button" ref={menuButton} className="btn btn--ghost btn--small" aria-expanded={menuOpen} aria-controls="dashboard-sidebar" onClick={() => setMenuOpen(value => !value)}><Icon name={menuOpen ? 'close' : 'list'} size={18} />Menu</button>
    </header>
    <aside id="dashboard-sidebar" className={'dashboard-sidebar' + (menuOpen ? ' is-open' : '')} onKeyDown={event => { if (event.key === 'Escape') closeMenu() }} onClick={followLink}>
      <Link to="/app" className="sidebar-logo" aria-label="SayGday home"><Logo /></Link>
      {dash.business && <div className="sidebar-business">
        <Avatar character={dash.business.character} colour={dash.business.buttonColour} size={36} />
        <div>{dash.businesses.length > 1
          ? <select aria-label="Which of your websites" value={dash.business.slug} onChange={event => { const slug = event.target.value; leaveAppearance(async () => { await dash.choose(slug); navigate('/app') }) }}>
            {dash.businesses.map(item => <option key={item.id} value={item.slug}>{item.name}</option>)}
          </select> : <strong>{dash.business.name}</strong>}
          <small>{dash.business.website?.replace(/^https?:\/\//, '').replace(/\/$/, '')}</small>
        </div>
      </div>}
      <nav className="sidebar-nav" aria-label="Dashboard">
        <p className="sidebar-label">Your workspace</p>
        <NavLink end to="/app"><Icon name="home" size={19} />Overview</NavLink>
        {ready && <>
          <NavLink to="/app/questions"><Icon name="list" size={19} />Questions &amp; answers{drafts > 0 && <span className="badge">{drafts}</span>}</NavLink>
          <NavLink to="/app/asked"><Icon name="inbox" size={19} />Customer questions{asked > 0 && <span className="badge">{asked}</span>}</NavLink>
          <NavLink to="/app/button"><Icon name="chat" size={19} />Chat appearance</NavLink>
        </>}
      </nav>
      {ready && <nav className="sidebar-setup" aria-label="Set up your chat">
        <p className="sidebar-label">Set up your chat</p>
        <ol>{checklist.map((item, index) => <li key={item.id}>
          <Link to={setupPath(item.id, dash.business.slug)} aria-current={location.pathname.startsWith('/app/setup') && selectedStep === item.id ? 'step' : undefined}>
            <span className={'setup-marker' + (item.complete ? ' is-complete' : '')} aria-hidden="true">{item.complete ? <Icon name="check" size={16} /> : index + 1}</span>
            <span><strong>{item.label}</strong><small>{item.complete ? 'Complete · ' : ''}{item.status}</small></span>
          </Link>
        </li>)}</ol>
      </nav>}
      <nav className="sidebar-nav sidebar-account" aria-label="Account and help">
        {dash.business && <NavLink to="/app/billing"><Icon name="card" size={19} />Billing{billingView(dash.billing).cancellationScheduled && <span className="sidebar-status">Cancelled</span>}</NavLink>}
        {dash.business && <NavLink to="/app/settings"><Icon name="settings" size={19} />Settings</NavLink>}
        <Link to="/app/add"><Icon name="plus" size={19} />Add a website</Link>
        <a href="/contact" target="_blank" rel="noopener noreferrer"><Icon name="mail" size={19} />Help &amp; support<Icon name="external" size={14} /></a>
        <button type="button" onClick={() => leaveAppearance(async () => { await signOut(); goToSignIn() })}><Icon name="back" size={19} />Sign out</button>
      </nav>
    </aside>
    <main className="container dashboard-main" id="dashboard-main" ref={main} tabIndex={-1}>
      {savingAppearance && <p role="status">Saving your appearance…</p>}
      {!dash.loading && dash.business && <BillingNotice billing={dash.billing} />}
      {dash.loading ? <Spinner label="Opening your dashboard…" /> : dash.error && !dash.business ? <div className="card"><Notice kind="error">{dash.error}</Notice><Button onClick={dash.reload} icon="refresh">Try again</Button></div> : <Outlet key={dash.business?.id} />}
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

// /app/add: another website under the same sign-in (a studio's next client).
export function AddWebsite() {
  return <Start another />
}

function Start({ another = false }) {
  const dash = useDash()
  const navigate = useNavigate()
  const [website, setWebsite] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { document.title = `${another ? 'Add a website' : 'Get started'} · SayGday` }, [another])
  async function submit(event) {
    event.preventDefault()
    if (!website.trim()) { setError('Enter your website’s address.'); return }
    setBusy(true); setError('')
    try {
      const result = await dash.request('createBusiness', { website })
      dash.added(result.business, result.scan)
      if (another) navigate('/app')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <div className="start">
    <section className="hero card card--green">
      <p className="eyebrow">{another ? 'Another website' : 'Start with your website'}</p>
      <h1>{another ? 'Put the next web address in.' : 'Put your web address in.'}</h1>
      <p className="lead">{another
        ? 'We’ll read this website too and write its questions and answers from its own pages. Each website gets its own chat, answers and button, all under this sign-in.'
        : 'We’ll read your website and write the 20 to 25 questions your customers ask most, with the answers from your own pages. You check every one before anything goes live.'}</p>
      <form className="hero__form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="website">Your website address</label>
        <div className="url-input"><span aria-hidden="true">https://</span><input id="website" value={website} onChange={event => setWebsite(event.target.value.replace(/^https?:\/\//i, ''))} placeholder="yourbusiness.com.au" autoComplete="url" autoCapitalize="none" spellCheck={false} inputMode="url" disabled={busy} aria-invalid={Boolean(error)} /></div>
        <Button type="submit" size="big" kind="gold" busy={busy} iconAfter="arrow">{busy ? 'Starting…' : 'Scan my website'}</Button>
      </form>
      {error && <p className="hero__error" role="alert">{error}</p>}
      {another && dash.business && <p className="small"><Link to="/app">Back to {dash.business.name}</Link></p>}
    </section>
    <ol className="steps">
      <li><span className="steps__icon"><Icon name="globe" size={30} /></span><strong>We read your website</strong><span>Your pages, menu, prices, hours and contact details. It takes a minute or two.</span></li>
      <li><span className="steps__icon"><Icon name="check" size={30} /></span><strong>You check the answers</strong><span>Approve, edit or remove each one. Add your own any time.</span></li>
      <li><span className="steps__icon"><Icon name="chat" size={30} /></span><strong>Make it yours, then activate</strong><span>Choose your icon, install and verify. Approve the final chat preview before adding your card.</span></li>
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
  const needsSetup = ['trial_not_started', 'card_required'].includes(billing.state)
  const setupStep = !live || drafts ? 'answers' : !dash.appearanceConfirmed ? 'appearance' : !verified ? 'install' : 'preview'
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
    : !verified ? { tone: 'gold', title: 'Put the chat button on your website', text: `${plural(live, 'answer')} ${live === 1 ? 'is' : 'are'} ready. Add one line to your website, then check that the website is yours. Billing shows whether your chat can run.`, action: <Button size="big" kind="gold" onClick={() => navigate('/app/button')} iconAfter="arrow">Show me how</Button> }
    : !billing.accessAllowed ? { tone: 'warn', title: billing.title, text: billing.description, action: <Button kind="dark" onClick={() => navigate('/app/billing')} iconAfter="arrow">View billing</Button> }
    : !seen ? { tone: 'green', title: 'Your chat is switched on', text: `We checked ${business.website.replace(/^https:\/\//, '')} is yours. Your button shows the next time your website loads.`, action: null }
    : { tone: 'green', title: 'Your chat is live on your website', text: `Customers can see ${plural(live, 'answer')}. Questions it can’t answer come to Customers asked.`, action: null }
  return <div className="overview">
    <header className="overview-heading"><div><p className="eyebrow">Your workspace</p><h1 className="greeting">G’day, {business.name}</h1><p className="lead">Here’s how your website chat is going.</p></div><Link className="btn btn--ghost" to={setupPath('preview', business.slug)}><Icon name="eye" size={18} />Preview chat</Link></header>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    {needsSetup ? <section className="next card card--gold">
      <div><h2>Let's get your chat ready</h2><p>Check your answers, choose your icon, then install and verify. Approve your finished chat before adding your card at the final step.</p></div>
      <div className="next__actions"><Button size="big" kind="gold" onClick={() => navigate(`/app/setup/${setupStep}?business=${encodeURIComponent(business.slug)}`)} iconAfter="arrow">Continue setup</Button></div>
    </section> : <section className={`next card card--${next.tone}`}>
      <div><h2>{next.title}</h2><p>{next.text}</p></div>
      {next.action && <div className="next__actions">{next.action}</div>}
    </section>}
    <h2 className="overview-subheading">At a glance</h2>
    <div className="tiles">
      <Tile to="/app/questions" icon="list" title="Approved answers" big={live} label={`${available ? 'live on your website' : 'approved answers saved'}${drafts ? ` · ${drafts} to check` : ''}`} />
      <Tile to="/app/asked" icon="inbox" title="Customer questions" big={business.counts?.newEnquiries || 0} label="new questions for you" />
      <Tile to="/app/questions?show=live" icon="eye" title="Answers read" big={business.counts?.views || 0} label="times by customers" />
    </div>
    <section className="card overview-chat">
      <div className="overview-chat__identity"><Avatar character={business.character} colour={business.buttonColour} size={56} /><div><p className="eyebrow">Your website chat</p><h2>{available ? seen ? 'Live on your website' : 'Ready on your website' : verified ? 'Your chat is paused' : 'Finish setting up your chat'}</h2><p>{billing.cancellationScheduled ? billing.description : available ? 'Customers see the answers you have approved.' : verified ? billing.description : 'Complete the setup steps in the side menu.'}</p></div></div>
      <Link className="btn btn--ghost" to="/app/button">Manage appearance<Icon name="arrow" size={18} /></Link>
    </section>
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

