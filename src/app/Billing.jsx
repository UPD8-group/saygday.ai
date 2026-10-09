import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button, Notice } from './ui.jsx'
import { billingActivationConfirmed, billingConfirmed, billingRedirect, billingReturn, billingView } from './billing-view.mjs'
import ActivationSuccess from './ActivationSuccess.jsx'

export function BillingNotice({ billing }) {
  const view = billingView(billing)
  // Setup and pricing stay with activation in Billing and Checkout.
  // Reserve dashboard banners for billing problems or upcoming service changes.
  if (['internal', 'setup_pending', 'trial_not_started', 'card_required'].includes(view.state) || !view.needsAttention) return null
  return <div className="billing-notice"><Notice kind={view.needsAttention ? 'warning' : 'info'}>
    <strong>{view.title}.</strong> {view.description} <Link to="/app/billing">View billing</Link>
  </Notice></div>
}

export default function Billing({ business, billing, request, refreshBilling, refreshing, refreshError }) {
  const location = useLocation()
  const navigate = useNavigate()
  const selectedBusiness = business?.slug || new URLSearchParams(location.search).get('business')
  const businessQuery = selectedBusiness ? `?business=${encodeURIComponent(selectedBusiness)}` : ''
  const checkoutPath = `/app/checkout${businessQuery}`
  const verificationPath = `/app/setup/install${businessQuery}`
  const returned = billingReturn(location.search)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(returned === 'confirming')
  const [activatedBusiness, setActivatedBusiness] = useState(null)
  const view = billingView(billing)
  const verificationNeeded = view.state === 'trial_not_started' && !view.checkoutAvailable

  const activationVisible = activatedBusiness === business?.id
    && billingActivationConfirmed(business, billing, 'confirming')

  useEffect(() => { setActivatedBusiness(null) }, [business?.id])

  useEffect(() => {
    if (activatedBusiness !== business?.id || returned !== 'confirming') return
    // Consume the return marker so refreshing or revisiting Billing does not
    // replay the celebration. Remove old #billing anchors as well.
    const params = new URLSearchParams(location.search)
    params.delete('checkout')
    navigate({ pathname: location.pathname, search: params.toString() ? `?${params}` : '', hash: '' }, { replace: true })
  }, [activatedBusiness, business?.id, returned, location.pathname, location.search, navigate])

  useEffect(() => {
    let alive = true
    let timer
    let attempts = 0
    setWaiting(returned === 'confirming')
    async function check() {
      const next = await refreshBilling()
      if (!alive) return
      if (billingActivationConfirmed(business, next, returned)) setActivatedBusiness(business.id)
      attempts += 1
      // Only server state confirms an active subscription. A webhook may
      // arrive after the redirect; stop automatically after six checks.
      if (returned === 'confirming' && !billingConfirmed(next) && attempts < 6) {
        timer = setTimeout(check, 2500)
      } else setWaiting(false)
    }
    check()
    return () => { alive = false; clearTimeout(timer) }
  }, [returned, refreshBilling, business?.id, business?.websiteVerifiedAt])

  async function refresh() {
    const next = await refreshBilling()
    if (billingActivationConfirmed(business, next, returned)) setActivatedBusiness(business.id)
  }

  async function open(action) {
    if (busy) return
    setBusy(action); setError('')
    try {
      const result = await request(action)
      window.location.assign(billingRedirect(result?.url, action))
    } catch (failure) { setError(failure.message); setBusy('') }
  }

  return <>
    {activatedBusiness === business?.id && <div hidden={!activationVisible}>
      <ActivationSuccess business={business} onContinue={() => navigate(`/app${businessQuery}`)} />
    </div>}
    <section className="card billing" id="billing" aria-labelledby="billing-title">
    <div className="billing__heading"><h2 id="billing-title">Billing</h2><span className="billing__price">A$40 <span>/ month AUD</span></span></div>
    <p><strong>SayGday Assistant</strong></p>
    <p className="small">Your website assistant shows the answers you approve and captures customer enquiries. Manage your answers, chat button and enquiries from your SayGday dashboard.</p>
    {(view.checkoutAvailable || ['trial_not_started', 'card_required'].includes(view.state)) && <p className="small"><strong>Card details are required to activate a new chat.</strong> Verify your website, then add your card securely through Stripe. Your first 14 live days are free, then A$40/month AUD automatically unless you cancel. You can build and preview before activating.</p>}
    <div className={`billing__state${view.needsAttention ? ' billing__state--attention' : ''}`} aria-live="polite">
      <h3>{view.title}</h3><p>{view.description}</p>
    </div>
    {returned === 'confirming' && <Notice>{waiting ? 'You’re back from Checkout. We’re checking your subscription with the server…' : billingConfirmed(billing) ? 'Your subscription status has been confirmed.' : 'Your subscription has not been confirmed yet. Confirmation can take a moment. Refresh below before trying another checkout.'}</Notice>}
    {returned === 'canceled' && <Notice>Checkout was closed. Your billing status below comes from the server; you can upgrade whenever you’re ready.</Notice>}
    {returned === 'returned' && <Notice>Welcome back. We’ve requested your latest billing status. Portal changes appear here once confirmed.</Notice>}
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <Notice kind="error">{refreshError}</Notice>
    {verificationNeeded && <div className="billing__state">
      <h3>Verify your website to continue</h3>
      <p id="billing-verification-note">Add your chat code to your website or verify your domain. Then return here to add your card and activate. Your 14 free days start when activation is complete.</p>
      <Link className="btn btn--gold" to={verificationPath}>Verify my website</Link>
    </div>}
    <div className="billing__actions">
      {verificationNeeded && <Button kind="gold" disabled aria-describedby="billing-verification-note">Add card and activate</Button>}
      {view.checkoutAvailable && <Button kind="gold" disabled={Boolean(busy) || refreshing || waiting} onClick={() => navigate(checkoutPath)} iconAfter="arrow">{view.state === 'card_required' ? 'Add card - 14 days free' : view.checkoutLabel}</Button>}
      {view.portalAvailable && <Button kind="dark" busy={busy === 'billingPortal'} disabled={Boolean(busy)} onClick={() => open('billingPortal')} iconAfter="external">Manage billing</Button>}
      <Button kind="ghost" busy={refreshing} disabled={Boolean(busy) || waiting} onClick={refresh} icon="refresh">Refresh billing status</Button>
    </div>
    {view.checkoutAvailable && <p className="small billing__terms">Checkout confirms your payment details and when monthly billing begins. If your free period is already running, its original end date stays the same. Cancel in Manage billing before the first charge to pay nothing.</p>}
    {view.portalAvailable && <p className="small billing__terms">Use the secure billing portal to update your payment method, see invoices or cancel. Your saved answers and enquiries stay available in this dashboard.</p>}
  </section></>
}

