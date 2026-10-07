import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, Icon, Notice, Spinner, when } from '../app/ui.jsx'
import { Avatar } from '../chat/Chat.jsx'
import { CHARACTERS, PLAIN_BUTTONS } from '../../shared/characters.mjs'
import { useAdmin } from './AdminApp.jsx'
import { STEPS, TRIAL_DAYS, dateLabel, number, plural, progressOf, stageOf } from './metrics.mjs'
import { Columns, Pips, StageChip, TrialMeter, host } from './parts.jsx'

const PLANS = [
  { key: 'trial', label: 'Free trial' },
  { key: 'paying', label: 'Paying' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'internal', label: 'Ours / test' },
]
const planLabel = key => PLANS.find(plan => plan.key === key)?.label || key
const DELIVERY = { sent: 'Sent to the business', pending: 'Waiting to send', failed: 'Couldn’t be sent', not_requested: 'No email left', not_queued: 'Not sent' }
const SCAN = { done: 'Finished', failed: 'Couldn’t finish', replaced: 'Replaced by a newer scan', queued: 'Waiting to start', reading: 'Reading now' }
const SOURCE = { scan: 'Drafted from the website', owner: 'Written by the owner', enquiry: 'From a customer’s question' }

// One business in full: everything SayGday knows about it, except what its
// customers asked and who they are (that stays in the business's own
// dashboard).
export default function BusinessDetail() {
  const { id } = useParams()
  const admin = useAdmin()
  const { request } = admin
  const [state, setState] = useState({ loading: true, error: '', detail: null })
  const load = useCallback(async () => {
    try { setState({ loading: false, error: '', detail: await request('business', { business: id }) }) }
    catch (error) { if (error.name !== 'AbortError') setState(previous => ({ ...previous, loading: false, error: error.message })) }
  }, [request, id])
  useEffect(() => { setState({ loading: true, error: '', detail: null }); load() }, [load])
  useEffect(() => { if (state.detail) document.title = `${state.detail.business.name} · Admin · SayGday` }, [state.detail])
  if (state.loading) return <Spinner label="Opening the business…" />
  if (!state.detail) return <div className="card"><Notice kind="error">{state.error}</Notice><Link to="/admin/businesses">Back to businesses</Link></div>
  const { detail } = state
  const business = detail.business
  const stage = stageOf(business, Date.now())
  // A plan changed here: this page, and every number on the others.
  const changed = updated => {
    setState(previous => ({ ...previous, detail: { ...previous.detail, business: { ...previous.detail.business, ...updated } } }))
    load(); admin.reload()
  }
  return <div className="business-detail">
    <p className="back"><Link to="/admin/businesses"><Icon name="back" size={18} />Businesses</Link></p>
    <div className="detail-head">
      <Avatar character={business.character} size={58} colour={business.buttonColour} />
      <div>
        <h1>{business.name}</h1>
        <p className="detail-head__meta">
          {business.website && <a href={business.website} target="_blank" rel="noopener noreferrer">{host(business.website)}<Icon name="external" size={15} /></a>}
          <StageChip stage={stage} />
          <span className="small">Added {dateLabel(business.createdAt)}</span>
        </p>
      </div>
    </div>
    <div className="detail-grid">
      <PlanCard detail={detail} stage={stage} onChange={changed} />
      <OwnerCard detail={detail} />
    </div>
    <Progress business={business} />
    <Use detail={detail} />
    <div className="detail-grid">
      <Asked detail={detail} />
      <Scans detail={detail} />
    </div>
    <Answers detail={detail} />
    <Look business={business} />
  </div>
}

function PlanCard({ detail, stage, onChange }) {
  const admin = useAdmin()
  const business = detail.business
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  async function choose(plan) {
    if (plan === business.plan || busy) return
    setBusy(plan); setError('')
    try { onChange((await admin.request('setPlan', { business: business.id, plan })).business) }
    catch (failure) { setError(failure.message) }
    finally { setBusy('') }
  }
  const trialStage = stageOf({ createdAt: business.createdAt }, Date.now())
  return <section className="card">
    <h2>Plan</h2>
    <p className="plan__days">Free days: {dateLabel(business.billing?.enabled ? business.billing.trialStartedAt : business.createdAt) || 'not started'} to {dateLabel(stage.endsAt) || 'not started'}{business.plan === 'trial' ? '.'
      : <span className="small"> ({trialStage.key === 'ended' ? 'over' : `day ${trialStage.day} of ${TRIAL_DAYS}`}).</span>}</p>
    {business.plan === 'trial' && <p><TrialMeter stage={stage} /></p>}
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <div className="segmented segmented--wrap" role="radiogroup" aria-label="Plan">
      {PLANS.map(plan => <button type="button" role="radio" key={plan.key} aria-checked={business.plan === plan.key}
        aria-busy={busy === plan.key || undefined} disabled={Boolean(busy) || business.billing?.hasCustomer} onClick={() => choose(plan.key)}>{plan.label}</button>)}
    </div>
    <p className="small">Set by hand while SayGday is billed by hand. It changes nothing for the business: it’s how these pages count revenue. Ours / test leaves the business out of every number.</p>
    {detail.plans.length > 0 && <ul className="history">{detail.plans.map(item => <li key={`${item.plan}-${item.at}`}><strong>{planLabel(item.plan)}</strong> <span className="small">{dateLabel(item.at)}, {when(item.at)}</span></li>)}</ul>}
  </section>
}

function OwnerCard({ detail }) {
  const { owner, business, otherBusinesses } = detail
  return <section className="card">
    <h2>Owner</h2>
    <dl className="facts-list">
      <dt>Sign-in</dt><dd className="cut">{owner?.email ? <a href={`mailto:${owner.email}`}>{owner.email}</a> : 'Couldn’t be read just now'}</dd>
      <dt>Signed up</dt><dd>{owner?.createdAt ? dateLabel(owner.createdAt) : '–'}</dd>
      <dt>Last signed in</dt><dd>{owner?.lastSignInAt ? when(owner.lastSignInAt) : 'Never'}</dd>
      <dt>Questions go to</dt><dd className="cut">{business.notifyEmail}</dd>
    </dl>
    {otherBusinesses.length > 0 && <>
      <h3>Their other websites</h3>
      <ul className="plain-list">{otherBusinesses.map(other => <li key={other.id}><Link to={`/admin/businesses/${other.id}`}>{other.name}</Link> <span className="small">{host(other.website)} · {planLabel(other.plan)}</span></li>)}</ul>
    </>}
  </section>
}

// Each step on its own, done or not, with what there is to know about it.
function Progress({ business }) {
  const answers = business.answers || {}
  const details = {
    added: dateLabel(business.createdAt),
    drafted: `${number(answers.fromScan)} from the website · ${number(answers.written)} written by the owner · ${number(answers.fromQuestions)} from customers’ questions`,
    approved: `${number(answers.approved)} approved · ${number(answers.drafts)} waiting to be checked · ${number(answers.featured)} shown when the chat opens`,
    proved: business.websiteVerifiedAt && `${business.verifiedBy === 'dns' ? 'By a DNS record' : 'By the chat button on its home page'}, ${dateLabel(business.websiteVerifiedAt)}`,
    live: business.buttonSeenAt && `Last seen ${when(business.buttonSeenAt)}`,
    read: `${plural(answers.read || 0, 'time')} all time`,
  }
  return <section className="card">
    <div className="card-head"><h2>Getting live</h2><Pips progress={progressOf(business)} /></div>
    <ol className="checklist">{STEPS.map((step, index) => {
      const done = step.done(business)
      return <li key={step.key} className={done ? 'is-done' : ''}>
        <span className="checklist__mark" aria-hidden="true">{done ? <Icon name="check" size={16} /> : index + 1}</span>
        <span><strong>{step.label}</strong><span className="small">{done ? details[step.key] : `Not yet: ${step.todo}`}</span></span>
      </li>
    })}</ol>
  </section>
}

function Use({ detail }) {
  const { summary } = useAdmin()
  const activity = detail.activity || []
  const since = summary.trackingSince
  const points = activity.map((day, index) => ({
    key: day.day, label: dateLabel(day.day, { short: true }), long: dateLabel(day.day),
    value: day.answersRead, partial: index === activity.length - 1, untracked: !since || day.day < since,
  }))
  const a = detail.business.activity || {}
  return <section className="card">
    <Columns title="Answers read each day" total={`${number(a.read7)} in the last 7 days · ${number(a.read30)} in 30`} points={points} current="Today"
      unit={n => n === 1 ? 'answer read' : 'answers read'}
      note={`On the website on ${plural(a.liveDays7 || 0, 'day')} of the last 7 and ${a.liveDays30 || 0} of the last 30.${since ? ` Counted from ${dateLabel(since)}.` : ''}`} />
  </section>
}

function Asked({ detail }) {
  const e = detail.business.enquiries || {}
  return <section className="card">
    <h2>Customers asked</h2>
    <p className="small">{plural(e.total || 0, 'question')} passed on, {number(e.new)} still new, {number(e.withEmail)} with an email to reply to. What was asked, and who asked, stays in the business’s own dashboard.</p>
    {detail.enquiries.length > 0 && <table className="admin-table admin-table--compact">
      <thead><tr><th scope="col">When</th><th scope="col">Email to the business</th><th scope="col">In their inbox</th></tr></thead>
      <tbody>{detail.enquiries.map((item, index) => <tr key={`${item.createdAt}-${index}`}>
        <td data-label="When">{dateLabel(item.createdAt)}</td>
        <td data-label="Email">{DELIVERY[item.delivery] || item.delivery}{item.failure ? <span className="small"> ({item.failure})</span> : null}</td>
        <td data-label="Inbox">{item.status === 'done' ? 'Done' : 'New'}</td>
      </tr>)}</tbody>
    </table>}
  </section>
}

function Scans({ detail }) {
  return <section className="card">
    <h2>Website scans</h2>
    {detail.scans.length ? <table className="admin-table admin-table--compact">
      <thead><tr><th scope="col">When</th><th scope="col">How it went</th><th scope="col" className="num">Pages</th><th scope="col" className="num">Drafted</th></tr></thead>
      <tbody>{detail.scans.map((scan, index) => <tr key={`${scan.createdAt}-${index}`}>
        <td data-label="When">{dateLabel(scan.createdAt)}</td>
        <td data-label="How it went">{SCAN[scan.status] || scan.status}{scan.error && scan.status === 'failed' ? <span className="small"> · {scan.error}</span> : null}</td>
        <td data-label="Pages" className="num">{scan.pages ?? '–'}</td>
        <td data-label="Drafted" className="num">{scan.drafted ?? '–'}</td>
      </tr>)}</tbody>
    </table> : <p className="small">No scans yet.</p>}
  </section>
}

function Answers({ detail }) {
  const [open, setOpen] = useState(false)
  const faqs = detail.faqs
  const shown = open ? faqs : faqs.slice(0, 8)
  return <section className="card">
    <div className="card-head"><h2>Questions and answers</h2><p className="small">{plural(faqs.length, 'question')}, most read first. Tap one for its answer.</p></div>
    {faqs.length ? <ul className="answers">{shown.map(faq => <li key={faq.id}><details>
      <summary>
        <span className="answers__q">{faq.question}</span>
        <span className="answers__meta">
          <span className={`chip ${faq.status === 'approved' ? 'chip--trial' : 'chip--ending'}`}>{faq.status === 'approved' ? 'Approved' : 'Draft'}</span>
          {faq.featured && <span className="chip chip--muted">Shown first</span>}
          <span className="small">{plural(faq.views, 'read')}</span>
        </span>
      </summary>
      <p className="answers__a">{faq.answer}</p>
      <p className="small">{SOURCE[faq.source] || faq.source}{/^https:\/\//.test(faq.sourceUrl || '') ? <> · <a href={faq.sourceUrl} target="_blank" rel="noopener noreferrer">the page it came from</a></> : null}</p>
    </details></li>)}</ul> : <p className="small">No questions yet.</p>}
    {faqs.length > 8 && <Button kind="ghost" onClick={() => setOpen(value => !value)}>{open ? 'Show fewer' : `Show all ${faqs.length}`}</Button>}
  </section>
}

function Look({ business }) {
  const look = [...CHARACTERS, ...PLAIN_BUTTONS].find(item => item.key === business.character)
  return <section className="card look-card">
    <h2>Chat button</h2>
    <div className="look-card__body">
      <Avatar character={business.character} size={64} colour={business.buttonColour} />
      <dl className="facts-list">
        <dt>Look</dt><dd>{look?.name || business.character}{look && 'animal' in look ? ` the ${look.animal}` : ''}</dd>
        <dt>Colour</dt><dd><span className="swatch" style={{ background: business.buttonColour }} aria-hidden="true" /> {business.buttonColour}</dd>
        <dt>Greeting</dt><dd>{business.greeting}</dd>
        <dt>Answers from</dt><dd>{business.signedBy || <span className="small">The business’s name (no name set)</span>}</dd>
        <dt>In its code</dt><dd className="cut"><code>data-business="{business.slug}"</code></dd>
      </dl>
    </div>
  </section>
}

