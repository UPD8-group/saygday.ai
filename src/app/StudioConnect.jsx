import { useEffect, useState } from 'react'
import { useAuth } from './auth.jsx'
import { Button, Field, Logo, Notice, Spinner } from './ui.jsx'
import { integrationRequest } from './integration-api.js'

export default function StudioConnect() {
  const { client, request } = useAuth()
  const [businesses, setBusinesses] = useState(null)
  const [business, setBusiness] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const params = new URLSearchParams(window.location.search)
  const state = params.get('state'), codeChallenge = params.get('code_challenge'), redirectUri = params.get('redirect_uri')
  const valid = /^[A-Za-z0-9_-]{32,128}$/.test(state || '') && /^[A-Za-z0-9_-]{43}$/.test(codeChallenge || '') && Boolean(redirectUri)

  useEffect(() => {
    document.title = 'Connect oo.studio · SayGday'
    if (!valid) return
    let current = true
    request('me').then(result => {
      if (!current) return
      const verified = result.businesses.filter(item => item.websiteVerifiedAt)
      setBusinesses(verified); setBusiness(verified[0]?.id || '')
    }).catch(failure => { if (current) { setError(failure.message); setBusinesses([]) } })
    return () => { current = false }
  }, [request, valid])

  async function connect(event) {
    event.preventDefault()
    if (!business || busy) return
    setBusy(true); setError('')
    try {
      const result = await integrationRequest(client, 'authorize', { business, state, codeChallenge, redirectUri })
      window.location.assign(result.redirectUrl)
    } catch (failure) { setError(failure.message); setBusy(false) }
  }

  return <main className="page"><div className="studio-connect"><a href="/app" aria-label="SayGday dashboard"><Logo /></a>
    <section className="card">
      <p className="eyebrow">A simpler workspace</p><h1>Connect to oo.studio</h1>
      {!valid ? <Notice kind="error">This connection link is incomplete. Start again from your oo.studio dashboard.</Notice> : <>
        <p>Manage your assistant alongside your website and other studio services.</p>
        <Notice kind="error">{error}</Notice>
        {businesses === null ? <Spinner label="Finding your businesses…" /> : businesses.length ? <form onSubmit={connect}>
          <Field label="Business to connect">{id => <select className="input" id={id} value={business} disabled={busy} onChange={event => setBusiness(event.target.value)}>{businesses.map(item => <option key={item.id} value={item.id}>{item.name} · {new URL(item.website).hostname}</option>)}</select>}</Field>
          <p>oo.studio will be able to:</p>
          <ul><li>Show this business and its assistant.</li><li>Read, add and edit questions and approved answers.</li><li>Read customer enquiries, including email addresses, and mark them as done.</li></ul>
          <p>Your account and subscription stay with SayGday. You can disconnect at any time in SayGday Settings. This connection lasts up to one year.</p>
          <div className="studio-connect__actions"><Button type="submit" busy={busy}>Connect this business</Button><a href="/app" className="small">Cancel</a></div>
        </form> : <p>Verify your business website in <a href="/app">your SayGday dashboard</a> before connecting it. Then start again from oo.studio.</p>}
      </>}
    </section>
  </div></main>
}

export function StudioConnections({ business }) {
  const { client } = useAuth()
  const [connections, setConnections] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    let current = true
    setConnections(null); setError('')
    integrationRequest(client, 'connections', { business: business.id }).then(result => { if (current) setConnections(result.connections) })
      .catch(failure => { if (current) { setError(failure.message); setConnections([]) } })
    return () => { current = false }
  }, [client, business.id])
  async function disconnect(id) {
    setBusy(id); setError('')
    try { await integrationRequest(client, 'disconnect', { id }); setConnections(rows => rows.filter(row => row.id !== id)) }
    catch (failure) { setError(failure.message) }
    finally { setBusy('') }
  }
  return <section className="card"><h2>Connected workspace</h2>
    <p>Manage connections for {business.name}. Disconnecting stops workspace access immediately; your SayGday account and chat keep working.</p>
    <Notice kind="error">{error}</Notice>
    {connections === null ? <Spinner label="Checking connections…" /> : connections.length ? <ul className="websites">{connections.map(item => <li key={item.id}><span><strong>oo.studio</strong><span className="small">Connected {new Date(item.createdAt).toLocaleDateString('en-AU')}</span></span><Button kind="ghost" busy={busy === item.id} disabled={Boolean(busy)} onClick={() => disconnect(item.id)}>Disconnect</Button></li>)}</ul> : <p className="small">No workspace connected. To connect, start in your oo.studio dashboard.</p>}
  </section>
}
