import { Link } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { useDash } from './Dashboard.jsx'
import { Button, Field, Icon, Notice, when } from './ui.jsx'
import Chat, { Avatar } from '../chat/Chat.jsx'
import { DEFAULT_BUTTON_COLOUR, buttonColour, buttonInk } from '../../shared/button-colour.mjs'
import { CHARACTERS, PLAIN_BUTTONS, characterImage, characterLabel, characterFor } from '../../shared/characters.mjs'
import { billingView } from './billing-view.mjs'

const PLATFORMS = [
  { key: 'any', label: 'Any website', steps: ['Copy the line of code above.', 'Paste it into your website just before </body>, or wherever your site lets you add custom code to every page.', 'Publish your website, verify it below, then activate billing to show the button.'] },
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
export function SwitchOn({ business, request, onBusiness, guided = false }) {
  const dash = useDash()
  const billing = billingView(dash.billing)
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
      if (result.verified) { onBusiness(result.business); await dash.refreshBilling() }
      else if (!quiet) setError((NOT_YET[result.reason] || NOT_YET.missing)(site))
    } catch (failure) { if (!quiet) setError(failure.message) }
    finally { if (!quiet) setBusy(false) }
  }, [request, onBusiness, site, dash.refreshBilling])
  // If the button is already on the website, opening this page switches it on.
  useEffect(() => { if (!guided && !verified && business.website) check(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  async function copyRecord() {
    try { await navigator.clipboard.writeText(record); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { /* the value stays on screen to copy by hand */ }
  }
  return <section id="verification" className="card switch-on">
    <h2>{guided ? 'Confirm your website' : '3. Switch it on'}</h2>
    {verified ? <>
      <p className="live-state"><Icon name="shield" size={18} />{`Website verified. We checked ${site} is yours${business.verifiedBy === 'dns' ? ' using your domain' : ''}, ${when(business.websiteVerifiedAt)}.`}</p>
      {guided ? <p className="live-state"><Icon name="check" size={18} />Website verified. Next, test your chat.</p> : <>
        <p className={`live-state${billing.accessAllowed && business.buttonSeenAt ? ' is-live' : ''}`}><Icon name={billing.accessAllowed && business.buttonSeenAt ? 'check' : 'globe'} size={18} />
          {!billing.accessAllowed ? (billing.state === 'card_required' ? 'Ready to activate. Add your card to start your 14 free live days.' : 'Your customer chat is paused. Check Billing.') : business.buttonSeenAt ? `Live on your website. Last seen ${when(business.buttonSeenAt)}.` : 'Your button shows the next time your website loads.'}</p>
        {!billing.accessAllowed && <Link className="btn btn--gold" to="/app/billing">{billing.state === 'card_required' ? 'Activate - 14 days free' : 'View billing'}</Link>}
      </>}
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
export default function ChatButton({ stage, onDirtyChange } = {}) {
  const dash = useDash()
  const { business } = dash
  const [character, setCharacter] = useState(business.character)
  const [colour, setColour] = useState(buttonColour(business.buttonColour))
  const [greeting, setGreeting] = useState(business.greeting)
  const [signedBy, setSignedBy] = useState(business.signedBy || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [platform, setPlatform] = useState('any')
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(true)
  useEffect(() => { document.title = 'Chat button · SayGday' }, [])
  const code = `<script src="${location.origin}/widget.js" data-business="${business.slug}" defer></script>`
  const simple = !characterFor(character)
  const launcherStyle = simple ? { background: colour, color: buttonInk(colour) } : undefined
  const changed = colour !== buttonColour(business.buttonColour) || character !== business.character || greeting.trim() !== business.greeting || signedBy.trim() !== (business.signedBy || '')
  useEffect(() => { if (stage === 'preview') onDirtyChange?.(changed) }, [stage, changed, onDirtyChange])
  const live = (dash.faqs || []).filter(faq => faq.status === 'approved')
  const showLook = !stage || stage === 'preview'
  const showInstall = !stage || stage === 'install'

  async function save() {
    setBusy(true); setError(''); setSaved('')
    try { const result = await dash.request('updateBusiness', { character, buttonColour: colour, greeting, signedBy: signedBy.trim() }); dash.setBusiness(result.business); setSaved('Saved. Your chat button shows this now.') }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { document.getElementById('install-code')?.select() }
  }
  if (stage === 'verify') return <SwitchOn business={business} request={dash.request} onBusiness={dash.setBusiness} guided />
  return <div className="button-page">
    <div className="section-head"><div><h1>{stage === 'install' ? 'Add it to your website' : stage === 'preview' ? 'Test your assistant' : 'Your chat button'}</h1><p className="lead">{stage === 'install' ? 'Add this code to your website, then continue to check it.' : stage === 'preview' ? 'Try the chat below. Adjust its look and greeting, then save your changes before continuing.' : 'Choose how it looks, then add it to your website with one line of code.'}</p></div></div>
    <div className={showLook ? 'button-grid' : undefined}>
      <div className="button-grid__settings">
        {showLook && <section className="card">
          <h2>{stage ? 'Choose its look' : '1. Choose its look'}</h2>
          <div className="looks" role="radiogroup" aria-label="Button look">
            <p className="looks__title">The mob</p>
            {CHARACTERS.map(item => <button key={item.key} type="button" role="radio" aria-checked={character === item.key} className={`look${character === item.key ? ' is-on' : ''}`} onClick={() => setCharacter(item.key)} title={characterLabel(item.key)}>
              <img src={characterImage(item.key)} alt="" width="56" height="56" /><span>{item.name}</span>
            </button>)}
            <p className="looks__title">Or keep it simple</p>
            {PLAIN_BUTTONS.map(item => <button key={item.key} type="button" role="radio" aria-checked={character === item.key} className={`look look--plain${character === item.key ? ' is-on' : ''}`} onClick={() => setCharacter(item.key)} title={characterLabel(item.key)}>
              <Avatar character={item.key} size={56} colour={colour} /><span>{item.name}</span>
            </button>)}
          </div>
          {simple ? <Field label="Simple button colour" hint="Applies to any simple style. The icon adjusts automatically to stay readable.">{(id, note) => <div className="button-colour"><input id={id} type="color" value={colour} aria-describedby={note} onChange={event => setColour(event.target.value)} /><span>{colour.toUpperCase()}</span><Button kind="ghost" onClick={() => setColour(DEFAULT_BUTTON_COLOUR)} disabled={colour === DEFAULT_BUTTON_COLOUR}>Reset colour</Button></div>}</Field> : <p className="small">Animal character colours are fixed. Choose a simple button to customise its colour.</p>}
          <Field label="Greeting" hint="The first thing customers read when they open the chat.">{(id, note) => <input id={id} aria-describedby={note} className="input" value={greeting} maxLength={200} onChange={event => setGreeting(event.target.value)} />}</Field>
          <Field label="Who signs off your answers (optional)" hint="A first name, like Sam. The chat says “Answers from Sam and the team”, and customers’ new questions are “one for Sam”. Leave it empty to show your business name.">{(id, note) => <input id={id} aria-describedby={note} className="input" value={signedBy} maxLength={40} autoComplete="given-name" onChange={event => setSignedBy(event.target.value)} />}</Field>
          <Notice kind="error">{error}</Notice><Notice kind="success">{saved}</Notice>
          <Button onClick={save} busy={busy} disabled={!changed || !greeting.trim()} icon="check">Save changes</Button>
        </section>}
        {showInstall && <section className="card">
          <h2>{stage ? 'Your installation code' : '2. Add it to your website'}</h2>
          <p>Copy this line and add it to your website. It works on Wix, Squarespace, WordPress, Shopify and most other sites.</p>
          <div className="code"><textarea id="install-code" readOnly value={code} rows={2} aria-label="Your chat button code" onFocus={event => event.target.select()} /><Button kind="dark" onClick={copy} icon={copied ? 'check' : 'copy'}>{copied ? 'Copied' : 'Copy'}</Button></div>
          <div className="platforms" role="tablist" aria-label="Your website builder">{PLATFORMS.map(item => <button key={item.key} role="tab" aria-selected={platform === item.key} onClick={() => setPlatform(item.key)}>{item.label}</button>)}</div>
          <ol className="platform-steps">{PLATFORMS.find(item => item.key === platform).steps.map((step, index) => <li key={step}>{stage === 'install' && platform === 'any' && index === 2 ? 'Publish your website, then continue to check it in the next step.' : step}</li>)}</ol>
        </section>}
        {!stage && <SwitchOn business={business} request={dash.request} onBusiness={dash.setBusiness} />}
      </div>
      {showLook && <section className="preview" aria-label="Preview">
        <p className="preview__label"><Icon name="eye" size={16} /> Preview: what customers see</p>
        <div className="preview__site">
          <div className="preview__bar"><span /><span /><span /><em>{business.website?.replace(/^https:\/\//, '')}</em></div>
          <div className="preview__page" aria-hidden="true"><i /><i /><i /><i className="short" /></div>
          {open && <div className="preview__panel"><Chat key={`${character}-${greeting}-${signedBy}-${live.length}`} widget={{ name: business.name, character, buttonColour: colour, greeting: greeting.trim() || business.greeting, signedBy: signedBy.trim(), faqs: live, slug: business.slug }} preview onClose={() => setOpen(false)} /></div>}
          <button type="button" className="preview__launcher" style={launcherStyle} onClick={() => setOpen(value => !value)} aria-label={open ? 'Close the preview chat' : 'Open the preview chat'}>
            {open ? <Icon name="close" size={24} /> : <Avatar character={character} size={56} colour={colour} />}
          </button>
        </div>
        {live.length === 0 && <p className="small">Approve some questions and they’ll appear here.</p>}
      </section>}
    </div>
  </div>
}

