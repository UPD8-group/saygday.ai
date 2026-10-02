import { useCallback, useEffect, useState } from 'react'
import { useDash } from './Dashboard.jsx'
import { Button, Field, Icon, Notice, when } from './ui.jsx'
import Chat, { Avatar } from '../chat/Chat.jsx'
import { CHARACTERS, PLAIN_BUTTONS, characterImage, characterLabel } from '../../shared/characters.mjs'

const PLATFORMS = [
  { key: 'any', label: 'Any website', steps: ['Copy the line of code above.', 'Paste it into your website just before </body>, or wherever your site lets you add custom code to every page.', 'Publish your website. The button appears in the bottom-right corner.'] },
  { key: 'wix', label: 'Wix', steps: ['In Wix, open Settings, then Custom code (under Advanced).', 'Choose “Add custom code”, paste the line, apply it to All pages and place it in Body – end.', 'Save, then publish your site.'] },
  { key: 'squarespace', label: 'Squarespace', steps: ['In Squarespace, open Settings, then Advanced, then Code injection.', 'Paste the line into the Footer box.', 'Save. (Code injection needs a Business plan or higher.)'] },
  { key: 'wordpress', label: 'WordPress', steps: ['Install a plugin that adds code to the footer, such as WPCode.', 'Add a new footer snippet and paste the line.', 'Save and turn the snippet on.'] },
  { key: 'shopify', label: 'Shopify', steps: ['In Shopify, open Online Store, then Themes, then Edit code.', 'Open theme.liquid and paste the line just before </body>.', 'Save.'] },
]

// What the owner is told when the check finds no proof yet.
const NOT_YET = {
  missing: site => `We read ${site} but couldn’t find your chat button on its home page yet. Check you’ve published the change, then try again.`,
  blocked: site => `${site} didn’t let us read its home page. Use your domain instead (below).`,
  unreachable: site => `We couldn’t reach ${site}. Check it’s online, then try again.`,
}

// The chat stays hidden until the business proves the website is its own
// (owner, 3 October 2026): the chat button on its home page, or a DNS record.
// The server also checks by itself the first time the button loads there.
export function SwitchOn({ business, request, onBusiness }) {
  const site = business.website?.replace(/^https:\/\//, '') || 'your website'
  const domain = site.replace(/^www\./, '')
  const verified = Boolean(business.websiteVerifiedAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const record = `saygday-verification=${business.verificationToken}`
  const check = useCallback(async (quiet = false) => {
    if (!quiet) { setBusy(true); setError('') }
    try {
      const result = await request('verifyWebsite')
      if (result.verified) onBusiness(result.business)
      else if (!quiet) setError((NOT_YET[result.reason] || NOT_YET.missing)(site))
    } catch (failure) { if (!quiet) setError(failure.message) }
    finally { if (!quiet) setBusy(false) }
  }, [request, onBusiness, site])
  // If the button is already on the website, opening this page switches it on.
  useEffect(() => { if (!verified && business.website) check(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function copyRecord() {
    try { await navigator.clipboard.writeText(record); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { /* the value stays on screen to copy by hand */ }
  }
  return <section className="card switch-on">
    <h2>3. Switch it on</h2>
    {verified ? <>
      <p className="live-state is-live"><Icon name="shield" size={18} />{`Switched on. We checked ${site} is yours${business.verifiedBy === 'dns' ? ' using your domain' : ''}, ${when(business.websiteVerifiedAt)}.`}</p>
      <p className={`live-state${business.buttonSeenAt ? ' is-live' : ''}`}><Icon name={business.buttonSeenAt ? 'check' : 'globe'} size={18} />
        {business.buttonSeenAt ? `Live on your website. Last seen ${when(business.buttonSeenAt)}.` : 'Your button shows the next time your website loads.'}</p>
    </> : <>
      <p>Your chat stays hidden until we’ve checked the button is on {site}, so nobody else can put answers out under your business’s name.</p>
      <p className="small">Published the change? Press the button below. We also check by ourselves the first time your website shows the button.</p>
      <Notice kind="error">{error}</Notice>
      <Button onClick={() => check(false)} busy={busy} icon="shield">Check my website</Button>
      <details className="dns">
        <summary>Can’t add the code to your home page? Use your domain instead</summary>
        <p>Add this record where your domain is managed (usually your domain registrar or web host), then press Check my website. It can take up to an hour to show.</p>
        <dl className="dns__record">
          <dt>Type</dt><dd>TXT</dd>
          <dt>Name</dt><dd>@ <span className="small">(for {domain} itself)</span></dd>
          <dt>Value</dt><dd><code>{record}</code></dd>
        </dl>
        <Button kind="ghost" onClick={copyRecord} icon={copied ? 'check' : 'copy'}>{copied ? 'Copied' : 'Copy the value'}</Button>
      </details>
    </>}
  </section>
}

// How the button looks, and how to put it on the website.
export default function ChatButton() {
  const dash = useDash()
  const { business } = dash
  const [character, setCharacter] = useState(business.character)
  const [greeting, setGreeting] = useState(business.greeting)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [platform, setPlatform] = useState('any')
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(true)
  useEffect(() => { document.title = 'Chat button · SayGday' }, [])
  const code = `<script src="${location.origin}/widget.js" data-business="${business.slug}" defer></script>`
  const changed = character !== business.character || greeting.trim() !== business.greeting
  const live = (dash.faqs || []).filter(faq => faq.status === 'approved')

  async function save() {
    setBusy(true); setError(''); setSaved('')
    try { const result = await dash.request('updateBusiness', { character, greeting }); dash.setBusiness(result.business); setSaved('Saved. Your chat button shows this now.') }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { document.getElementById('install-code')?.select() }
  }
  return <div className="button-page">
    <div className="section-head"><div><h1>Your chat button</h1><p className="lead">Choose how it looks, then add it to your website with one line of code.</p></div></div>
    <div className="button-grid">
      <div className="button-grid__settings">
        <section className="card">
          <h2>1. Choose its look</h2>
          <div className="looks" role="radiogroup" aria-label="Button look">
            <p className="looks__title">The mob</p>
            {CHARACTERS.map(item => <button key={item.key} type="button" role="radio" aria-checked={character === item.key} className={`look${character === item.key ? ' is-on' : ''}`} onClick={() => setCharacter(item.key)} title={characterLabel(item.key)}>
              <img src={characterImage(item.key)} alt="" width="56" height="56" /><span>{item.name}</span>
            </button>)}
            <p className="looks__title">Or keep it simple</p>
            {PLAIN_BUTTONS.map(item => <button key={item.key} type="button" role="radio" aria-checked={character === item.key} className={`look look--plain${character === item.key ? ' is-on' : ''}`} onClick={() => setCharacter(item.key)} title={characterLabel(item.key)}>
              <Avatar character={item.key} size={56} /><span>{item.name}</span>
            </button>)}
          </div>
          <Field label="Greeting" hint="The first thing customers read when they open the chat.">{(id, note) => <input id={id} aria-describedby={note} className="input" value={greeting} maxLength={200} onChange={event => setGreeting(event.target.value)} />}</Field>
          <Notice kind="error">{error}</Notice><Notice kind="success">{saved}</Notice>
          <Button onClick={save} busy={busy} disabled={!changed || !greeting.trim()} icon="check">Save</Button>
        </section>
        <section className="card">
          <h2>2. Add it to your website</h2>
          <p>Copy this line and add it to your website. It works on Wix, Squarespace, WordPress, Shopify and most other sites.</p>
          <div className="code"><textarea id="install-code" readOnly value={code} rows={2} aria-label="Your chat button code" onFocus={event => event.target.select()} /><Button kind="dark" onClick={copy} icon={copied ? 'check' : 'copy'}>{copied ? 'Copied' : 'Copy'}</Button></div>
          <div className="platforms" role="tablist" aria-label="Your website builder">{PLATFORMS.map(item => <button key={item.key} role="tab" aria-selected={platform === item.key} onClick={() => setPlatform(item.key)}>{item.label}</button>)}</div>
          <ol className="platform-steps">{PLATFORMS.find(item => item.key === platform).steps.map(step => <li key={step}>{step}</li>)}</ol>
        </section>
        <SwitchOn business={business} request={dash.request} onBusiness={dash.setBusiness} />
      </div>
      <section className="preview" aria-label="Preview">
        <p className="preview__label"><Icon name="eye" size={16} /> Preview: what customers see</p>
        <div className="preview__site">
          <div className="preview__bar"><span /><span /><span /><em>{business.website?.replace(/^https:\/\//, '')}</em></div>
          <div className="preview__page" aria-hidden="true"><i /><i /><i /><i className="short" /></div>
          {open && <div className="preview__panel"><Chat key={`${character}-${greeting}-${live.length}`} widget={{ name: business.name, character, greeting: greeting.trim() || business.greeting, faqs: live, slug: business.slug }} preview onClose={() => setOpen(false)} /></div>}
          <button type="button" className="preview__launcher" onClick={() => setOpen(value => !value)} aria-label={open ? 'Close the preview chat' : 'Open the preview chat'}>
            {open ? <Icon name="close" size={24} /> : <Avatar character={character} size={56} />}
          </button>
        </div>
        {live.length === 0 && <p className="small">Approve some questions and they’ll appear here.</p>}
      </section>
    </div>
  </div>
}
