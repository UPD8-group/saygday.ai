import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useDash } from './Dashboard.jsx'
import { Button, Notice, Spinner, plural } from './ui.jsx'
import Questions from './Questions.jsx'
import ChatButton from './ChatButton.jsx'
import Billing from './Billing.jsx'
import { SETUP_STEPS, setupFlow, setupPath } from './setup-flow.mjs'

const INTRO = {
  answers: 'Check the answers your customers will see. You can edit, approve or remove each one.',
  install: 'Add one line of code to your website. Your chat stays hidden while you finish setup.',
  verify: 'Check that your chat code is installed, or prove ownership with a domain record.',
  preview: 'Choose your button and try your approved answers before activating.',
  billing: 'Add your card securely to activate your chat. Checkout shows your first billing date before you confirm.',
}

export default function Setup() {
  const dash = useDash()
  const { step = 'answers' } = useParams()
  const navigate = useNavigate()
  const [previewDirty, setPreviewDirty] = useState(false)
  const flow = setupFlow({ step, business: dash.business, faqs: dash.faqs })
  const path = next => setupPath(next, dash.business.slug)

  useEffect(() => {
    document.title = `${SETUP_STEPS[flow.index].label} - SayGday setup`
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [flow.current, flow.index])

  if (!flow.loaded) return <Spinner label="Loading your answers." />
  if (step !== flow.current) return <Navigate to={path(flow.current)} replace />

  return <div className="setup">
    <header className="setup-heading">
      <p className="eyebrow">Step {flow.index + 1} of {SETUP_STEPS.length}</p>
      <h1>Set up your chat</h1>
      <p className="lead">{INTRO[flow.current]}</p>
    </header>
    <nav aria-label="Chat setup steps">
      <ol className="setup-steps">{SETUP_STEPS.map((item, index) => <li key={item.id} className={index === flow.index ? 'is-current' : index < flow.index ? 'is-done' : ''}>
        <Link to={path(item.id)} aria-current={item.id === flow.current ? 'step' : undefined}><span aria-hidden="true">{index + 1}</span>{item.label}</Link>
      </li>)}</ol>
    </nav>

    {flow.current === 'answers' && <Questions guided />}
    {['install', 'verify', 'preview'].includes(flow.current) && <ChatButton key={flow.current} stage={flow.current} onDirtyChange={setPreviewDirty} />}
    {flow.current === 'billing' && <Billing business={dash.business} billing={dash.billing} request={dash.request} refreshBilling={dash.refreshBilling} refreshing={dash.billingRefreshing} refreshError={dash.billingError} />}

    <section className="setup-actions card" aria-label="Continue setup">
      {flow.current === 'answers' && !flow.approved && <p>Approve at least one answer to continue.</p>}
      {flow.current === 'answers' && flow.approved > 0 && flow.drafts > 0 && <Notice>{plural(flow.drafts, 'draft answer')} still {flow.drafts === 1 ? 'needs' : 'need'} checking. You can continue with your approved answers; drafts stay hidden.</Notice>}
      {flow.current === 'verify' && !flow.verified && <p>Use Check my website above. Once verification succeeds, you can continue to preview.</p>}
      {flow.current === 'preview' && previewDirty && <p>Save your changes above before continuing to payment.</p>}
      <div className="billing__actions">
        {flow.previous && <Link className="btn btn--ghost" to={path(flow.previous)}>Back</Link>}
        {flow.next && <Button kind="gold" size="big" disabled={!flow.canContinue || (flow.current === 'preview' && previewDirty)} onClick={() => navigate(path(flow.next))} iconAfter="arrow">{flow.nextLabel}</Button>}
        {flow.current === 'billing' && <Link className="btn btn--ghost" to="/app">Back to dashboard</Link>}
      </div>
    </section>
  </div>
}
