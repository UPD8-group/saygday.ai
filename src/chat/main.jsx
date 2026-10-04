import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Chat from './Chat.jsx'
import { createWidgetReader } from './widget-reader.mjs'
import './chat.css'

// The page inside the chat window on a business's website (chat.html,
// opened by public/widget.js). It refreshes approved answers before replying.
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
const readWidget = createWidgetReader(async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(`/api/chat?business=${encodeURIComponent(slug)}&site=${encodeURIComponent(site)}&fresh=1`, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) throw new Error('The current answers aren’t available. Please try again.')
    return await response.json()
  } finally { clearTimeout(timer) }
})

function App() {
  const [widget, setWidget] = useState(null)
  const [failed, setFailed] = useState(false)
  const currentWidget = useCallback(async () => {
    const current = await readWidget()
    setWidget(current)
    setFailed(false)
    return current
  }, [])
  useEffect(() => {
    if (!site) return
    const refresh = () => { currentWidget().catch(() => setFailed(true)) }
    const opened = event => {
      if (event.source === window.parent && event.origin === site && event.data?.source === 'saygday' && event.data?.type === 'refresh') refresh()
    }
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('message', opened)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('message', opened)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [currentWidget])
  useEffect(() => { if (widget) document.title = `${widget.name} · Questions` }, [widget])
  if (!site) return <div className="chat chat--unavailable"><p style={{ padding: 24 }}>This chat opens from the business’s own website.</p></div>
  if (failed && !widget) return <div className="chat chat--unavailable"><p style={{ padding: 24 }}>This chat isn’t available right now. Please try again later.</p></div>
  if (!widget) return <div className="chat" aria-busy="true" />
  return <Chat widget={widget} api={{ ...api, currentWidget }} onClose={window.parent !== window ? close : undefined} />
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
