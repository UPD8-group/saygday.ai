import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDash } from './Dashboard.jsx'
import { Button, Empty, Icon, Notice, Spinner, when } from './ui.jsx'

// Questions customers asked that the chat couldn't answer. With an email,
// the owner can reply; either way they can add an answer for next time.
export default function Asked() {
  const dash = useDash()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [counts, setCounts] = useState({ new: 0, done: 0 })
  const [nextCursor, setNextCursor] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const requestVersion = useRef(0)
  useEffect(() => { document.title = 'Customers asked · SayGday' }, [])
  async function load(cursor = null) {
    const version = ++requestVersion.current
    setError('')
    if (cursor) setLoadingMore(true)
    else { setItems(null); setNextCursor(null); setLoadingMore(false) }
    try {
      const result = await dash.request('listEnquiries', { status: showDone ? 'done' : 'new', cursor })
      if (version !== requestVersion.current) return
      setItems(current => cursor ? [...(current || []), ...result.enquiries.filter(item => !(current || []).some(old => old.id === item.id))] : result.enquiries)
      setCounts(result.counts)
      setNextCursor(result.nextCursor)
    } catch (failure) {
      if (version === requestVersion.current) { setError(failure.message); if (!cursor) setItems([]) }
    } finally { if (version === requestVersion.current) setLoadingMore(false) }
  }
  useEffect(() => {
    load()
    return () => { requestVersion.current += 1 }
  }, [showDone]) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(item, status) {
    setError(''); setBusy(true)
    try {
      await dash.request('setEnquiry', { id: item.id, status })
      await load()
      dash.reload()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  async function remove(item) {
    setError(''); setBusy(true)
    try { await dash.request('deleteEnquiry', { id: item.id }); await load(); dash.reload() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  const visible = items || []
  return <div className="asked">
    <div className="section-head">
      <div><h1>Customers asked</h1><p className="lead">Questions your chat couldn’t answer. Reply to the customer, and add an answer so the chat can answer it next time.</p></div>
    </div>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <div className="segmented" role="tablist" aria-label="Which questions">
      <button role="tab" aria-selected={!showDone} disabled={busy} onClick={() => setShowDone(false)}>New <span>{counts.new}</span></button>
      <button role="tab" aria-selected={showDone} disabled={busy} onClick={() => setShowDone(true)}>Done <span>{counts.done}</span></button>
    </div>
    {items === null ? <Spinner /> : error && visible.length === 0 ? <Button kind="ghost" onClick={() => load()}>Try again</Button> : visible.length === 0 ? <Empty icon="inbox" title={showDone ? 'Nothing marked done yet' : 'All caught up'}>
      <p>{showDone ? 'Questions you’ve dealt with appear here.' : 'When someone asks something your chat can’t answer, it appears here, and you get an email if they left their address.'}</p>
    </Empty> : <ul className="asked-list">{visible.map(item => <li key={item.id} className="asked-item card">
      <p className="asked-item__question">“{item.question}”</p>
      <p className="asked-item__meta">
        <span>{when(item.createdAt)}</span>
        {item.email ? <span><Icon name="mail" size={14} />{item.email}</span> : <span>No email left</span>}
      </p>
      {item.email && <p className="asked-item__meta">{notificationLabel(item.notification)}</p>}
      <div className="asked-item__actions">
        {item.email && <a className="btn btn--small btn--primary" href={`mailto:${item.email}?subject=${encodeURIComponent(`Your question to ${dash.business.name}`)}&body=${encodeURIComponent(`Hi,\n\nYou asked: “${item.question}”\n\n`)}`}><Icon name="mail" size={18} /><span>Reply by email</span></a>}
        <Button size="small" kind="dark" icon="plus" onClick={() => navigate(`/app/questions?add=1&question=${encodeURIComponent(item.question.slice(0, 200))}&enquiry=${item.id}`)}>Add an answer</Button>
        {item.status === 'new' ? <Button size="small" kind="ghost" icon="check" disabled={busy} onClick={() => setStatus(item, 'done')}>Mark done</Button>
          : <Button size="small" kind="ghost" disabled={busy} onClick={() => setStatus(item, 'new')}>Move back to new</Button>}
        <Button size="small" kind="ghost" icon="trash" disabled={busy} onClick={() => remove(item)}>Delete</Button>
      </div>
    </li>)}</ul>}
    {items !== null && nextCursor && <Button kind="ghost" busy={loadingMore} disabled={busy} onClick={() => load(nextCursor)}>Load older questions</Button>}
  </div>
}

function notificationLabel(status) {
  if (status === 'sent') return 'Email notification sent.'
  if (status === 'pending') return 'Email notification pending — we’ll retry automatically. You can reply here now.'
  if (status === 'failed') return 'Email notification failed. Your customer’s question is saved here — use Reply by email.'
  return 'Saved here. No email notification is recorded.'
}
