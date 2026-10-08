import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Field, Icon, Notice, Spinner } from './ui.jsx'
import { checkoutBootstrap, checkoutDay, checkoutView } from './checkout-view.mjs'
import { loadCheckoutStripe, requestCheckoutBootstrap } from './checkout-stripe.mjs'

const APPEARANCE = {
  theme: 'stripe',
  variables: { colorPrimary: '#31584A', colorText: '#14211c', colorDanger: '#a3322b', borderRadius: '12px', fontFamily: 'system-ui, sans-serif', fontSizeBase: '16px' },
}

export function CheckoutForBusiness({ business, ownerEmail, request }) {
  const navigate = useNavigate()
  const mount = useRef(null)
  const active = useRef(null)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState('loading')
  const [view, setView] = useState(null)
  const [email, setEmail] = useState(ownerEmail || '')
  const [emailLocked, setEmailLocked] = useState(false)
  const [error, setError] = useState('')
  const [paymentReady, setPaymentReady] = useState(false)
  const settings = `/app/settings?business=${encodeURIComponent(business.slug)}#billing`
  const completed = `/app/settings?business=${encodeURIComponent(business.slug)}&checkout=success#billing`

  useEffect(() => { document.title = `Checkout — ${business.name} — SayGday` }, [business.name])

  useEffect(() => {
    const run = { disposed: false, failed: false, confirming: false, checkout: null, actions: null, element: null, bootstrap: null, view: null, day: checkoutDay() }
    active.current = run
    setStatus('loading'); setError(''); setView(null); setPaymentReady(false); setEmailLocked(false)
    let timer
    let loadTimer
    const current = () => !run.disposed && !run.failed && active.current === run
    const fail = message => {
      if (!current()) return
      run.failed = true
      clearTimeout(loadTimer)
      setError(message); setStatus('error'); setPaymentReady(false)
    }
    const update = session => {
      if (!current() || run.failed) return
      try {
        const next = checkoutView(session, run.bootstrap)
        if (next.complete) {
          // This only prompts the server to reconcile. It grants no access.
          navigate(completed, { replace: true })
          return
        }
        run.view = next
        setView(next)
      } catch (failure) { fail(failure.message) }
    }
    const timeCheck = () => {
      if (!current() || run.confirming) return
      if (Date.now() >= run.bootstrap?.expiresAt * 1000) fail('This checkout has expired. Reload checkout to continue.')
      else if (checkoutDay() !== run.day) fail('A new day has started. Reload checkout to check your first billing date before confirming.')
    }
    async function start() {
      try {
        // Capture the selected business explicitly, including after any await.
        const result = await requestCheckoutBootstrap(request, business.id)
        if (!current()) return
        run.bootstrap = checkoutBootstrap(result, business.id)
        const Stripe = await loadCheckoutStripe()
        if (!current()) return
        run.checkout = Stripe(run.bootstrap.publishableKey).initCheckoutElementsSdk({
          clientSecret: run.bootstrap.clientSecret,
          elementsOptions: { appearance: APPEARANCE, loader: 'auto' },
        })
        const loaded = await run.checkout.loadActions()
        if (!current()) return
        if (loaded.type !== 'success') throw new Error(loaded.error?.message || 'Stripe could not open checkout. Please try again.')
        run.actions = loaded.actions
        const session = run.actions.getSession()
        if (session.email) { setEmail(session.email); setEmailLocked(true) }
        update(session)
        if (!current() || !run.view) return
        run.checkout.on('change', update)
        run.element = run.checkout.createPaymentElement({ layout: 'accordion' })
        run.element.on('ready', () => {
          if (!current() || run.failed) return
          clearTimeout(loadTimer); setPaymentReady(true); setStatus('ready')
        })
        run.element.on('loaderror', () => fail('The secure card form could not load. Please reload checkout.'))
        run.element.mount(mount.current)
        timer = setInterval(timeCheck, 1000)
        window.addEventListener('focus', timeCheck)
      } catch (failure) {
        // Deliberately do not log the session or error object: they may include
        // a Checkout client secret. The UI receives plain explanatory text.
        if (current()) fail(failure?.name === 'AppError' && typeof failure.code === 'string'
          ? failure.message
          : 'Checkout could not load. Check your connection, then reload checkout.')
      }
    }
    loadTimer = setTimeout(() => fail('Checkout is taking too long to load. Please reload checkout.'), 45000)
    start()
    return () => {
      run.disposed = true
      if (active.current === run) active.current = null
      clearTimeout(loadTimer); clearInterval(timer)
      window.removeEventListener('focus', timeCheck)
      // The Checkout SDK has no destroy/off method. Destroy its mounted Element
      // and ignore all outstanding callbacks after a switch or StrictMode replay.
      run.element?.destroy()
    }
  }, [attempt, business.id, request, navigate, completed])

  async function confirm(event) {
    event.preventDefault()
    const run = active.current
    if (!run || run.disposed || run.confirming || status !== 'ready' || !paymentReady || !run.actions) return
    if (Date.now() >= run.bootstrap.expiresAt * 1000 || checkoutDay() !== run.day) {
      setStatus('error'); setError('Please reload checkout to check the current billing date before confirming.'); return
    }
    run.confirming = true
    setStatus('confirming'); setError('')
    try {
      const latest = checkoutView(run.actions.getSession(), run.bootstrap)
      if (latest.complete) { navigate(completed, { replace: true }); return }
      if (latest.quoteKey !== view.quoteKey) {
        run.view = latest; setView(latest)
        setError('Your checkout details have changed. Please review the date and amount, then confirm again.')
        return
      }
      // Stripe validates the card fields and any authentication needed. This is
      // the only code path that confirms, and it runs only on this form submit.
      const result = await run.actions.confirm({ email: email.trim(), returnUrl: new URL(completed, window.location.origin).href, redirect: 'if_required' })
      if (run.disposed || active.current !== run) return
      if (result.type === 'error') setError(result.error?.message || 'Your card could not be confirmed. Check the details and try again.')
      else if (result.type === 'success') navigate(completed, { replace: true })
      else setError('We could not confirm the result. Return to Billing and refresh your status before trying again.')
    } catch {
      if (!run.disposed && active.current === run) setError('We could not confirm the result. Return to Billing and refresh your status before trying again.')
    } finally {
      run.confirming = false
      if (!run.disposed && !run.failed && active.current === run) setStatus('ready')
    }
  }

  const busy = status === 'confirming'
  return <div className="checkout">
    <Link className="checkout__back" to={settings}><Icon name="back" size={18} />Back to billing</Link>
    <div className="checkout__grid">
      <section className="card checkout__summary" aria-labelledby="checkout-title">
        <p className="eyebrow">Your SayGday subscription</p>
        <p className="checkout__business">{business.name}</p>
        <h1 id="checkout-title">{view?.title || 'Let’s get your chat ready.'}</h1>
        {view && <>
          <p className="checkout__rate">A$30 <span>/ month AUD</span></p>
          <p className="checkout__intro">{view.trial ? `Nothing to pay today. Your first A$30 payment is on ${view.date}, then monthly unless you cancel.` : 'Your first A$30 payment is today, then monthly unless you cancel.'}</p>
          <dl className="checkout__totals"><div><dt>Due today</dt><dd>{view.dueToday} <span>AUD</span></dd></div>{view.trial && <div><dt>First payment</dt><dd>{view.date}</dd></div>}<div><dt>Then</dt><dd>A$30 / month AUD</dd></div></dl>
          <p className="checkout__cancel"><Icon name="check" size={18} /><span>{view.trial ? 'Cancel in Manage billing before your first payment to pay nothing.' : 'Cancel in Manage billing any time to stop the next renewal.'}</span></p>
          {view.trial && <p className="small checkout__timezone">Billing dates shown in Sydney time.</p>}
        </>}
        {status === 'loading' && !view && <Spinner label="Checking your billing date and amount…" />}
      </section>
      <section className="card checkout__payment" aria-labelledby="payment-title">
        <div className="checkout__secure"><Icon name="shield" size={20} />Secure checkout with Stripe</div>
        <h2 id="payment-title">{view?.trial === false ? 'Start your subscription' : 'Add your card to activate'}</h2>
        <p className="small">Your card details go directly to Stripe. SayGday never sees your full card number.</p>
        <Notice kind="error">{error}</Notice>
        {status === 'error' && <Button kind="dark" onClick={() => setAttempt(value => value + 1)} icon="refresh">Reload checkout</Button>}
        <form onSubmit={confirm} hidden={status === 'error'} aria-busy={status === 'loading' || busy}>
          <Field label="Billing email" hint="Stripe sends your subscription and payment updates here.">{(id, note) => <input id={id} className="input" type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} readOnly={emailLocked} disabled={busy || status === 'loading'} aria-describedby={note} />}</Field>
          <div className="checkout__element" ref={mount} />
          {!paymentReady && <Spinner label="Loading the secure card form…" />}
          {view && <p className="checkout__consent">{view.trial ? `By confirming, you authorise A$30/month AUD from ${view.date} until you cancel.` : 'By subscribing, you authorise A$30 today and A$30/month AUD until you cancel.'} You agree to our <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>}
          <Button kind="gold" size="big" type="submit" busy={busy} disabled={!view || !paymentReady || status !== 'ready'} iconAfter="arrow">{busy ? 'Confirming securely…' : view?.button || 'Preparing checkout…'}</Button>
          {view?.trial && <p className="checkout__nothing">{view.dueToday} AUD due today</p>}
        </form>
      </section>
    </div>
  </div>
}
