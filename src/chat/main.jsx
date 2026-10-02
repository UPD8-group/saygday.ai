import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Chat from './Chat.jsx'
import './chat.css'

// The page inside the chat window on a business's website (chat.html,
// opened by public/widget.js). It reads the business's approved answers once.
const slug = new URLSearchParams(location.search).get('business') || ''
const post = body => fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: slug, ...body }) })
const api = {
  viewed: faqId => { post({ action: 'viewed', faqId }).catch(() => {}) },
  async ask({ question, email, website }) {
    let response
    try { response = await post({ action: 'ask', question, email, website }) } catch { throw new Error('We couldn’t send that. Check your connection and try again.') }
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error || 'That didn’t send. Please try again.')
    return body
  },
}
const close = () => window.parent?.postMessage({ source: 'saygday', type: 'close' }, '*')

function App() {
  const [widget, setWidget] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch(`/api/chat?business=${encodeURIComponent(slug)}`).then(response => (response.ok ? response.json() : Promise.reject())).then(setWidget).catch(() => setFailed(true))
  }, [])
  useEffect(() => { if (widget) document.title = `${widget.name} · Questions` }, [widget])
  if (failed) return <div className="chat chat--unavailable"><p style={{ padding: 24 }}>This chat isn’t available right now. Please try again later.</p></div>
  if (!widget) return <div className="chat" aria-busy="true" />
  return <Chat widget={widget} api={api} onClose={window.parent !== window ? close : undefined} />
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
