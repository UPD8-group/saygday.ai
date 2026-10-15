import { useEffect, useState } from 'react'
import { Button, Field, Notice } from './ui.jsx'
import { billingDate } from './billing-view.mjs'

export default function ComplimentaryCodes({ request }) {
  const [email, setEmail] = useState('')
  const [codes, setCodes] = useState([])
  const [issued, setIssued] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  async function load() {
    try { setCodes((await request('listComplimentaryCodes')).codes); setLoaded(true); setError('') }
    catch (failure) { setError(failure.message) }
  }
  useEffect(() => {
    let alive = true
    request('listComplimentaryCodes').then(result => { if (alive) { setCodes(result.codes); setLoaded(true) } })
      .catch(failure => { if (alive) setError(failure.message) })
    return () => { alive = false }
  }, [request])
  async function create(event) {
    event.preventDefault()
    if (busy) return
    setBusy('create'); setError(''); setIssued(null)
    try {
      const result = await request('createComplimentaryCode', { email })
      setIssued(result); setEmail(''); setCodes(previous => [result.item, ...previous].slice(0, 100))
    } catch (failure) { setError(failure.message) }
    finally { setBusy('') }
  }
  async function revoke(item) {
    if (busy) return
    setBusy(item.id); setError('')
    try {
      const result = await request('revokeComplimentaryCode', { codeId: item.id })
      setCodes(previous => previous.map(code => code.id === item.id ? result.item : code))
      if (issued?.item.id === item.id) setIssued(null)
    } catch (failure) { setError(failure.message) }
    finally { setBusy('') }
  }
  return <section className="card complimentary-admin" aria-labelledby="complimentary-admin-title">
    <h2 id="complimentary-admin-title">Give a client free access</h2>
    <p>Create a private code for the email your client uses to sign in. Each code works once, for one website. They enter it in their dashboard under Billing.</p>
    <form onSubmit={create}>
      <Field label="Client’s sign-in email">{(id, note) => <input id={id} aria-describedby={note} className="input" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={Boolean(busy)} />}</Field>
      <Button type="submit" busy={busy === 'create'} disabled={Boolean(busy)}>Create complimentary code</Button>
    </form>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    {!loaded && error && <Button kind="ghost" onClick={load}>Try again</Button>}
    {issued && <div className="complimentary-issued" role="status">
      <strong>Code for {issued.item.email}</strong>
      <label htmlFor="issued-complimentary-code">Copy this code and send it to your client</label>
      <input id="issued-complimentary-code" className="input complimentary-code" readOnly value={issued.code} onFocus={event => event.target.select()} />
      <p className="small">Shown only now. Redeem by {billingDate(issued.item.expiresAt)}. Free access continues until you revoke it.</p>
    </div>}
    <p className="small">Revoking free access does not restart a cancelled subscription or charge a saved card. The client must choose to subscribe to continue when their original free period ends.</p>
    <h3>Recent codes</h3>
    {!loaded && !codes.length ? <p className="small">Loading codes…</p> : !codes.length ? <p className="small">No codes created yet.</p> : <ul className="complimentary-list">
      {codes.map(item => {
        const expired = Date.parse(item.expiresAt) <= Date.now()
        const status = item.revokedAt ? 'Revoked' : item.redeemedAt ? 'Free access active' : expired ? 'Expired' : item.claimed ? 'Application pending' : 'Ready to use'
        return <li key={item.id}>
          <div><strong>{item.email}</strong><p className="small">{status}{item.website ? ` · ${item.website.replace(/^https:\/\//, '')}` : ''}</p>
            {!item.redeemedAt && !item.revokedAt && <p className="small">Redeem by {billingDate(item.expiresAt)}</p>}</div>
          {!item.revokedAt && (item.redeemedAt || !expired) && <Button kind="ghost" size="small" busy={busy === item.id} disabled={Boolean(busy)} onClick={() => revoke(item)}>{item.redeemedAt ? 'Revoke free access' : 'Revoke code'}</Button>}
        </li>
      })}
    </ul>}
  </section>
}
