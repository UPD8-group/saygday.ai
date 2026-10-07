import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDash } from './Dashboard.jsx'
import { Button, Empty, Field, Icon, Notice, plural } from './ui.jsx'
import { respond, variantClashes } from '../../shared/matcher.mjs'

// The owner's questions and answers: check the scan's drafts, edit, remove,
// add their own, choose which show when the chat opens, and try the chat.
export default function Questions() {
  const dash = useDash()
  const [params, setParams] = useSearchParams()
  const faqs = dash.faqs || []
  const drafts = faqs.filter(faq => faq.status === 'draft')
  const live = faqs.filter(faq => faq.status === 'approved')
  // Until the owner picks, show what needs checking first.
  const [picked, setShow] = useState(() => (params.get('show') === 'live' ? 'live' : null))
  const show = picked || (drafts.length ? 'drafts' : 'live')
  const [adding, setAdding] = useState(() => params.get('add') === '1' ? { question: params.get('question') || '', enquiry: params.get('enquiry') || '' } : null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Questions · SayGday' }, [])
  useEffect(() => { if (picked === 'drafts' && !drafts.length) setShow(null) }, [drafts.length, picked])

  // A variant that would find another answer shows the wrong answer: say so.
  const clashes = useMemo(() => variantClashes(live), [live])
  const list = show === 'drafts' ? drafts : live

  function replace(faq) { dash.setFaqs(current => current.map(item => (item.id === faq.id ? faq : item))) }
  async function save(fields, faq) {
    setError('')
    const result = await dash.request('saveFaq', { ...fields, ...(faq ? { id: faq.id } : {}) })
    if (faq) replace(result.faq)
    else dash.setFaqs(current => [...current, result.faq])
    return result.faq
  }
  async function act(work, message) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); if (message) setNotice(message) } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const approveAll = () => act(async () => {
    const result = await dash.request('approveAll')
    dash.setFaqs(result.faqs)
    dash.reload()
    setShow('live')
  }, `Done. ${plural(drafts.length, 'answer')} ${drafts.length === 1 ? 'is' : 'are'} ready for your chat.`)

  return <div className="questions">
    <div className="section-head">
      <div><h1>Questions & answers</h1><p className="lead">Your chat only ever shows the answers you’ve approved, word for word.</p></div>
      <Button onClick={() => setAdding({ question: '' })} icon="plus">Add a question</Button>
    </div>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <Notice kind="success" onClose={() => setNotice('')}>{notice}</Notice>
    {adding && <Editor title="Add a question" initial={{ question: adding.question, answer: '', variants: [] }} onCancel={() => { setAdding(null); setParams({}) }}
      onSave={async fields => {
        await save({ ...fields, fromEnquiry: Boolean(adding.enquiry) })
        if (adding.enquiry) await dash.request('setEnquiry', { id: adding.enquiry, status: 'done' }).catch(() => {})
        setAdding(null); setParams({}); setShow('live'); setNotice('Added to your approved answers.'); dash.reload()
      }} />}
    {drafts.length > 0 && <section className="review card card--gold">
      <div><h2>{plural(drafts.length, 'question')} from your website to check</h2><p>Read each answer. Approve it, fix it, or remove it. Nothing shows on your website until you approve it.</p></div>
      <div className="review__actions">{show !== 'drafts' && <Button kind="dark" onClick={() => setShow('drafts')}>Check one by one</Button>}<Button kind="ghost" onClick={approveAll} busy={busy} icon="check">Approve all {drafts.length}</Button></div>
    </section>}
    <div className="segmented" role="tablist" aria-label="Which questions">
      <button role="tab" aria-selected={show === 'drafts'} onClick={() => setShow('drafts')} disabled={!drafts.length}>To check <span>{drafts.length}</span></button>
      <button role="tab" aria-selected={show === 'live'} onClick={() => setShow('live')}>Approved <span>{live.length}</span></button>
    </div>
    {show === 'live' && clashes.length > 0 && <Notice kind="error">
      {clashes.slice(0, 3).map(clash => <p key={`${clash.entry.id}-${clash.phrasing}`}>“{clash.phrasing}” (a way of asking “{clash.entry.question}”) also matches “{clash.other.question}”. Edit one of them so each question clearly finds its own answer.</p>)}
    </Notice>}
    {list.length === 0 ? <Empty icon="list" title={show === 'drafts' ? 'Nothing to check' : 'No approved answers yet'}>
      <p>{show === 'drafts' ? 'You’ve checked everything from your website.' : 'Approve the questions from your website, or add your own.'}</p>
    </Empty> : <ul className="faq-list">{list.map(faq => <FaqCard key={faq.id} faq={faq} featuredCount={live.filter(item => item.featured).length} onSave={fields => save(fields, faq)}
      onDelete={() => act(async () => { await dash.request('deleteFaq', { id: faq.id }); dash.setFaqs(current => current.filter(item => item.id !== faq.id)) })}
      onError={setError} />)}</ul>}
    {live.length > 0 && <TryIt faqs={live} name={dash.business.name} />}
  </div>
}

function FaqCard({ faq, featuredCount, onSave, onDelete, onError }) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  async function quick(fields) {
    setBusy(true)
    try { await onSave(fields) } catch (failure) { onError(failure.message) } finally { setBusy(false) }
  }
  if (editing) return <li><Editor title="Edit" initial={faq} onCancel={() => setEditing(false)} onSave={async fields => { await onSave(fields); setEditing(false) }} /></li>
  const draft = faq.status === 'draft'
  return <li className={`faq card${draft ? ' faq--draft' : ''}`}>
    <div className="faq__body">
      <h3>{faq.question}</h3>
      <p>{faq.answer}</p>
      {faq.variants?.length > 0 && <p className="faq__variants"><span>Also finds:</span> {faq.variants.join(' · ')}</p>}
      <p className="faq__meta">
        {faq.source === 'scan' && faq.sourceUrl && <a href={faq.sourceUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={14} />From {faq.sourceUrl.replace(/^https:\/\//, '')}</a>}
        {!draft && <span><Icon name="eye" size={14} />Read {plural(faq.views || 0, 'time')}</span>}
      </p>
    </div>
    <div className="faq__actions">
      {draft ? <Button size="small" onClick={() => quick({ status: 'approved' })} busy={busy} icon="check">Approve</Button>
        : <button type="button" className={`star${faq.featured ? ' is-on' : ''}`} aria-pressed={faq.featured} disabled={busy || (!faq.featured && featuredCount >= 6)} onClick={() => quick({ featured: !faq.featured })}
          title={faq.featured ? 'Shown when the chat opens' : featuredCount >= 6 ? 'Six questions already show when the chat opens' : 'Show when the chat opens'}>
          <Icon name="star" size={18} />{faq.featured ? 'Shown first' : 'Show first'}</button>}
      <Button size="small" kind="ghost" onClick={() => setEditing(true)} icon="edit">Edit</Button>
      {confirming ? <span className="confirm">Remove it? <Button size="small" kind="danger" onClick={onDelete}>Remove</Button><Button size="small" kind="ghost" onClick={() => setConfirming(false)}>Keep</Button></span>
        : <Button size="small" kind="ghost" onClick={() => setConfirming(true)} icon="trash">Remove</Button>}
    </div>
  </li>
}

function Editor({ title, initial, onSave, onCancel }) {
  const [question, setQuestion] = useState(initial.question || '')
  const [answer, setAnswer] = useState(initial.answer || '')
  const [variants, setVariants] = useState((initial.variants || []).join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (question.trim().length < 3 || !answer.trim()) { setError('Add the question and its answer.'); return }
    setBusy(true); setError('')
    try {
      await onSave({ question, answer, variants: variants.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12), ...(initial.status === 'draft' ? { status: 'approved' } : {}) })
    } catch (failure) { setError(failure.message); setBusy(false) }
  }
  return <form className="editor card" onSubmit={submit}>
    <h2>{title}</h2>
    <Notice kind="error">{error}</Notice>
    <Field label="The question" hint="How a customer would ask it.">{(id, note) => <input id={id} aria-describedby={note} className="input" value={question} maxLength={200} onChange={event => setQuestion(event.target.value)} placeholder="Do you have parking?" autoFocus />}</Field>
    <Field label="Your answer" hint="Exactly what customers will see.">{(id, note) => <textarea id={id} aria-describedby={note} className="input" rows={4} value={answer} maxLength={1500} onChange={event => setAnswer(event.target.value)} placeholder="Yes, there’s free street parking right out front." />}</Field>
    <Field label="Other ways customers might ask it (optional)" hint="One per line. These help the chat find this answer.">{(id, note) => <textarea id={id} aria-describedby={note} className="input" rows={3} value={variants} onChange={event => setVariants(event.target.value)} placeholder={'where can I park\nis there parking'} />}</Field>
    <div className="editor__actions">
      <Button type="submit" busy={busy} icon="check">{initial.status === 'draft' ? 'Save and approve' : 'Save'}</Button>
      <Button kind="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
    </div>
  </form>
}

// The owner tries a question the way a customer would: the same matching the
// chat uses, with no AI and nothing sent anywhere.
function TryIt({ faqs, name }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  return <section className="try card">
    <h2><Icon name="search" /> Try a question</h2>
    <p>Type a question the way a customer might. You’ll see what your chat would do.</p>
    <form onSubmit={event => { event.preventDefault(); if (text.trim()) setResult(respond(text, faqs, { name })) }} className="try__form">
      <label className="visually-hidden" htmlFor="try-question">A customer’s question</label>
      <input id="try-question" className="input" value={text} onChange={event => { setText(event.target.value); setResult(null) }} placeholder="are you open on sunday?" />
      <Button type="submit" kind="dark">Try it</Button>
    </form>
    {result && <div className="try__result" role="status">
      {result.kind === 'answer' && <><strong>Your chat answers:</strong><p className="try__answer"><em>{result.entry.question}</em><br />{result.entry.answer}</p></>}
      {result.kind === 'suggest' && <><strong>Your chat asks “Is it one of these?”</strong><ul>{result.options.map(option => <li key={option.id}>{option.question}</li>)}</ul><p className="small">If none fits, the customer can send it to you.</p></>}
      {result.kind === 'smalltalk' && <><strong>Your chat replies:</strong><p>{result.text}</p></>}
      {result.kind === 'none' && <><strong>Your chat doesn’t have an answer for that.</strong><p>It offers to send the question to you, and asks for the customer’s email so you can reply. Add it as a question if customers ask it often.</p></>}
    </div>}
  </section>
}

