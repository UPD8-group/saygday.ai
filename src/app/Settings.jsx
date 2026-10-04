import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { goToSignIn, useDash } from './Dashboard.jsx'
import { useAuth } from './auth.jsx'
import { Button, Field, Notice } from './ui.jsx'

export default function Settings() {
  const dash = useDash()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { business } = dash
  const [name, setName] = useState(business.name)
  const [notifyEmail, setNotifyEmail] = useState(business.notifyEmail)
  const [website, setWebsite] = useState(business.website?.replace(/^https:\/\//, '') || '')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  useEffect(() => { document.title = 'Settings · SayGday' }, [])

  async function save(event) {
    event.preventDefault()
    setBusy('save'); setError(''); setSaved('')
    try { const result = await dash.request('updateBusiness', { name, notifyEmail }); dash.setBusiness(result.business); setSaved('Saved.') }
    catch (failure) { setError(failure.message) }
    finally { setBusy('') }
  }
  async function rescan(event) {
    event.preventDefault()
    setBusy('scan'); setError(''); setSaved('')
    try {
      const result = await dash.request('startScan', { website })
      dash.setBusiness(result.business); dash.setScan(result.scan)
      navigate('/app')
    } catch (failure) { setError(failure.message); setBusy('') }
  }
  return <div className="settings">
    <div className="section-head"><div><h1>Settings</h1></div></div>
    <Notice kind="error" onClose={() => setError('')}>{error}</Notice>
    <Notice kind="success" onClose={() => setSaved('')}>{saved}</Notice>
    <form className="card" onSubmit={save}>
      <h2>Your business</h2>
      <Field label="Business name" hint="Shown at the top of your chat.">{(id, note) => <input id={id} aria-describedby={note} className="input" value={name} maxLength={120} onChange={event => setName(event.target.value)} />}</Field>
      <Field label="Email for customers’ questions" hint="Where we send questions your chat couldn’t answer, when the customer leaves their email.">{(id, note) => <input id={id} aria-describedby={note} className="input" type="email" value={notifyEmail} maxLength={254} onChange={event => setNotifyEmail(event.target.value)} />}</Field>
      <Button type="submit" busy={busy === 'save'} disabled={!name.trim() || !notifyEmail.trim() || (name === business.name && notifyEmail === business.notifyEmail)}>Save</Button>
    </form>
    <section className="card">
      <h2>Your websites</h2>
      <p>Each website has its own chat, answers and button, all under this sign-in. Switch between them here or at the top of the page.</p>
      <ul className="websites">
        {dash.businesses.map(item => <li key={item.id}>
          <span><strong>{item.name}</strong><span className="small">{item.website?.replace(/^https:\/\//, '')}</span></span>
          {item.id === business.id ? <span className="small">This one</span> : <Button kind="ghost" onClick={() => { dash.choose(item.slug); navigate('/app') }}>Switch</Button>}
        </li>)}
      </ul>
      <Button kind="dark" onClick={() => navigate('/app/add')} icon="plus">Add another website</Button>
    </section>
    <form className="card" onSubmit={rescan}>
      <h2>Scan your website again</h2>
      <p>Changed your website? We’ll read it again and add new questions for you to check. Your approved answers and the ones you’ve written stay exactly as they are.</p>
      <Field label="Website address">{id => <div className="url-input url-input--light"><span aria-hidden="true">https://</span><input id={id} value={website} onChange={event => setWebsite(event.target.value.replace(/^https?:\/\//i, ''))} inputMode="url" autoCapitalize="none" spellCheck={false} /></div>}</Field>
      <Button type="submit" kind="dark" busy={busy === 'scan'} icon="refresh">Scan my website</Button>
    </form>
    <section className="card">
      <h2>Your account</h2>
      <p>Signed in as <strong>{dash.email}</strong>.</p>
      <Button kind="ghost" onClick={async () => { await signOut(); goToSignIn() }}>Sign out</Button>
    </section>
  </div>
}
