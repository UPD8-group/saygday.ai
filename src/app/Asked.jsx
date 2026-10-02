import { useEffect, useState } from 'react'
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
  useEffect(() => { document.title = 'Customers asked · SayGday' }, [])
  useEffect(() => {
    dash.request('listEnquiries').then(result => setItems(result.enquiries)).catch(failure => setError(failure.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(item, status) {
    setError('')
    try {
      await dash.request('setEnquiry', { id: item.id, status })
      setItems(current => current.map(entry => (entry.id === item.id ? { ...entry, status } : entry)))
      dash.reload()
    } catch (failure) { setError(failure.message) }
  }
  async function remove(item) {
    setError('')
    try { await dash.request('deleteEnquiry', { id: item.id }); setItems(current => current.filter(entry => entry.id !== item.id)); dash.reload() }
    catch (failure) { setError(failure.message) }
  }
  const visible = (items || []).filter(item => (showDone ? item.status === 'done' : item.status === 'new'))
  const doneCount = (items || []).filter(item => item.status === 'done').length
  return <div className="asked">
    <div className="section-head">
      <div><h1>Customers asked</h1><p className="lead">Questions your chat couldn’t answer. Reply to the customer, and add an answer so the chat can answer it next time.</p></div>
    </div>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <div className="segmented" role="tablist" aria-label="Which questions">
      <button role="tab" aria-selected={!showDone} onClick={() => setShowDone(false)}>New <span>{(items || []).length - doneCount}</span></button>
      <button role="tab" aria-selected={showDone} onClick={() => setShowDone(true)}>Done <span>{doneCount}</span></button>
    </div>
    {items === null ? <Spinner /> : visible.length === 0 ? <Empty icon="inbox" title={showDone ? 'Nothing marked done yet' : 'All caught up'}>
      <p>{showDone ? 'Questions you’ve dealt with appear here.' : 'When someone asks something your chat can’t answer, it appears here, and you get an email if they left their address.'}</p>
    </Empty> : <ul className="asked-list">{visible.map(item => <li key={item.id} className="asked-item card">
      <p className="asked-item__question">“{item.question}”</p>
      <p className="asked-item__meta">
        <span>{when(item.createdAt)}</span>
        {item.email ? <span><Icon name="mail" size={14} />{item.email}</span> : <span>No email left</span>}
      </p>
      <div className="asked-item__actions">
        {item.email && <a className="btn btn--small btn--primary" href={`mailto:${item.email}?subject=${encodeURIComponent(`Your question to ${dash.business.name}`)}&body=${encodeURIComponent(`Hi,\n\nYou asked: “${item.question}”\n\n`)}`}><Icon name="mail" size={18} /><span>Reply by email</span></a>}
        <Button size="small" kind="dark" icon="plus" onClick={() => navigate(`/app/questions?add=1&question=${encodeURIComponent(item.question.slice(0, 200))}&enquiry=${item.id}`)}>Add an answer</Button>
        {item.status === 'new' ? <Button size="small" kind="ghost" icon="check" onClick={() => setStatus(item, 'done')}>Mark done</Button>
          : <Button size="small" kind="ghost" onClick={() => setStatus(item, 'new')}>Move back to new</Button>}
        <Button size="small" kind="ghost" icon="trash" onClick={() => remove(item)}>Delete</Button>
      </div>
    </li>)}</ul>}
  </div>
}
