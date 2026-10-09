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
  appearance: 'Choose your icon, colour and greeting. Save your choices before adding the chat to your website.',
  install: 'Add one line of code to your website. Your chat stays hidden while you finish setup.',
  verify: 'Check that your chat code is installed, or prove ownership with a domain record.',
  preview: 'This is your finished chat, with your chosen icon and saved answers. Try it as a customer, then approve it before billing.',
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
    setPreviewDirty(false)
  }, [flow.current, flow.index])

  if (!flow.loaded) return <Spinner label="Loading your answers." />
  if (step !== flow.current) return <Navigate to={path(flow.current)} replace />
  if (flow.current === 'billing' && !dash.previewApproved) return <Navigate to={path('preview')} replace />

  return <div className="setup">
    <header className="setup-heading">
      <p className="eyebrow">Step {flow.index + 1} of {SETUP_STEPS.length}</p>
      <h1>{SETUP_STEPS[flow.index].label}</h1>
      <p className="lead">{INTRO[flow.current]}</p>
    </header>
    {flow.current === 'answers' && <Questions guided />}
    {['appearance', 'install', 'verify', 'preview'].includes(flow.current) && <ChatButton key={flow.current} stage={flow.current} onDirtyChange={setPreviewDirty} />}
    {flow.current === 'billing' && <Billing business={dash.business} billing={dash.billing} request={dash.request} refreshBilling={dash.refreshBilling} refreshing={dash.billingRefreshing} refreshError={dash.billingError} />}

    <section className="setup-actions card" aria-label="Continue setup">
      {flow.current === 'answers' && !flow.approved && <p>Approve at least one answer to continue.</p>}
      {flow.current === 'answers' && flow.approved > 0 && flow.drafts > 0 && <Notice>{plural(flow.drafts, 'draft answer')} still {flow.drafts === 1 ? 'needs' : 'need'} checking. You can continue with your approved answers; drafts stay hidden.</Notice>}
      {flow.current === 'verify' && !flow.verified && <p>Use Check my website above. Once verification succeeds, you can continue to preview.</p>}
      {flow.current === 'appearance' && previewDirty && <p>Save your choices above before continuing.</p>}
      {flow.current === 'preview' && <p><strong>Happy with your chat?</strong> Approve this preview to continue to billing. No payment is taken by this button.</p>}
      <div className="billing__actions">
        {flow.previous && <Link className="btn btn--ghost" to={path(flow.previous)}>Back</Link>}
        {flow.next && <Button kind="gold" size="big" disabled={!flow.canContinue || (flow.current === 'appearance' && previewDirty)} onClick={() => { if (flow.current === 'appearance') dash.confirmChatAppearance(); if (flow.current === 'preview') dash.approveChatPreview(); navigate(path(flow.next)) }} iconAfter="arrow">{flow.nextLabel}</Button>}
        {flow.current === 'billing' && <Link className="btn btn--ghost" to="/app">Back to dashboard</Link>}
      </div>
    </section>
  </div>
}
