import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Chat from './Chat.jsx'
import './chat.css'

// The page inside the chat window on a business's website (chat.html,
// opened by public/widget.js). It reads the business's approved answers once.
// It only opens inside the business's own website: it tells the server which
// website holds it (the browser's own record of the page, which a page can't
// fake), and the server answers only for the business's verified website.
const slug = new URLSearchParams(location.search).get('business') || ''
function holdingSite() {
  if (window.parent === window) return null
  if (location.ancestorOrigins?.length) return location.ancestorOrigins[0]
  try { return document.referrer ? new URL(document.referrer).origin : null } catch { return null }
}
const site = holdingSite()
const post = body => fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business: slug, site, ...body }) })
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
    if (!site) return
    fetch(`/api/chat?business=${encodeURIComponent(slug)}&site=${encodeURIComponent(site)}`).then(response => (response.ok ? response.json() : Promise.reject())).then(setWidget).catch(() => setFailed(true))
  }, [])
  useEffect(() => { if (widget) document.title = `${widget.name} · Questions` }, [widget])
  if (!site) return <div className="chat chat--unavailable"><p style={{ padding: 24 }}>This chat opens from the business’s own website.</p></div>
  if (failed) return <div className="chat chat--unavailable"><p style={{ padding: 24 }}>This chat isn’t available right now. Please try again later.</p></div>
  if (!widget) return <div className="chat" aria-busy="true" />
  return <Chat widget={widget} api={api} onClose={window.parent !== window ? close : undefined} />
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
