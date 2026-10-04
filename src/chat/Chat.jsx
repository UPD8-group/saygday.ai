import { useEffect, useMemo, useRef, useState } from 'react'
import { respond, typeahead } from '../../shared/matcher.mjs'
import { characterFor, characterImage, plainSvg } from '../../shared/characters.mjs'
import { EMAIL, chatWords, emailIn, questionFor } from './words.mjs'
import { currentFaq, handoffConfirmation } from './widget-reader.mjs'

// The chat on a business's website, and its preview in the dashboard. It
// only ever shows answers the business approved, word for word. A question it
// can't match is offered to the business's team, never guessed at. It looks
// like the example on saygday.ai's front page (owner, 3 October 2026): mint
// answers, and a question it can't answer goes straight to the named person's
// inbox. No handwritten name or stamp on answers (owner, the same day).
let counter = 0
const key = () => `m${++counter}`
const TICK = <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
const ARROW = <svg width="14" height="14" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 9h11m-4-4.5L14.5 9 10 13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>

export function Avatar({ character, size = 40 }) {
  const found = characterFor(character)
  if (found) return <img className="chat-avatar" src={characterImage(found.key)} alt="" width={size} height={size} />
  // A plain button: one of the shapes in shared/characters.mjs (fixed markup,
  // never anything a business or visitor typed).
  return <span className="chat-avatar chat-avatar--bubble" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: plainSvg(character, Math.round(size * 0.5)) }} />
}

export default function Chat({ widget, preview = false, api = {}, onClose }) {
  const faqs = useMemo(() => widget?.faqs || [], [widget])
  const words = chatWords(widget)
  const starters = useMemo(() => {
    const featured = faqs.filter(faq => faq.featured)
    return (featured.length ? featured : faqs).slice(0, 6)
  }, [faqs])
  const [messages, setMessages] = useState(() => [{ id: key(), from: 'bot', kind: 'greeting' }])
  const [text, setText] = useState('')
  const [asked, setAsked] = useState(() => new Set())
  // Questions passed on to the team, and offers an email typed into the
  // question box has taken the place of.
  const [sent, setSent] = useState(() => new Set())
  const [replaced, setReplaced] = useState(() => new Set())
  const log = useRef(null)
  const input = useRef(null)
  const reading = useRef(false)
  const [busy, setBusy] = useState(false)
  const [readError, setReadError] = useState('')
  const suggestions = useMemo(() => typeahead(text, faqs), [text, faqs])

  useEffect(() => { log.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [messages])

  function add(...items) { setMessages(current => [...current.filter(item => item.kind !== 'typing'), ...items.map(item => ({ id: key(), ...item }))]) }

  function appendAnswer(faq, askedAs) {
    setAsked(current => new Set(current).add(faq.id))
    add({ from: 'me', text: askedAs || faq.question }, { from: 'bot', kind: 'answer', faq, askedAs })
    if (!preview) api.viewed?.(faq.id)
    setText('')
  }

  async function withCurrentAnswers(action) {
    if (reading.current) return
    reading.current = true
    setBusy(true)
    setReadError('')
    try {
      const current = preview || !api.currentWidget ? widget : await api.currentWidget()
      action(current)
    } catch {
      setReadError('We couldn’t check the latest answers. Please try again.')
    } finally {
      reading.current = false
      setBusy(false)
      setBusy(false)
    }
  }

  function showAnswer(faq, askedAs) {
    return withCurrentAnswers(current => {
      const latest = currentFaq(current, faq.id)
      if (latest) return appendAnswer(latest, askedAs)
      // A chip from an earlier message may have been removed by its owner.
      add({ from: 'me', text: askedAs || faq.question }, { from: 'bot', kind: 'ask', question: askedAs || faq.question })
      setText('')
    })
  }

  function submit(event) {
    event.preventDefault()
    const question = text.replace(/\s+/g, ' ').trim()
    if (!question || reading.current) return
    // "Please message me jo@example.com": the visitor wants a reply, so the
    // offer to pass the question on comes back with their address filled in.
    const email = emailIn(question)
    if (email) {
      setText('')
      const pending = questionFor(messages, sent, question)
      if (pending.replaces) setReplaced(current => new Set(current).add(pending.replaces))
      return add({ from: 'me', text: question }, { from: 'bot', kind: 'ask', question: pending.question, email, quoted: pending.question !== question })
    }
    return withCurrentAnswers(current => {
      const faqs = current?.faqs || []
      const context = { name: current?.name || 'us' }
      const decision = respond(question, faqs, context)
      setText('')
      if (decision.kind === 'answer') return appendAnswer(decision.entry, question)
      add({ from: 'me', text: question })
      if (decision.kind === 'smalltalk') return add({ from: 'bot', kind: 'text', text: decision.text })
      if (decision.kind === 'suggest') return add({ from: 'bot', kind: 'suggest', options: decision.options, question })
      add({ from: 'bot', kind: 'ask', question })
    })
  }

  const more = starters.filter(faq => !asked.has(faq.id)).slice(0, 3)
  const shared = { widget, words, starters, showAnswer, add, preview, api, replaced, onSent: id => setSent(current => new Set(current).add(id)) }
  return <div className="chat" aria-label={`Questions for ${widget?.name || 'this business'}`}>
    <header className="chat__head">
      <Avatar character={widget?.character} />
      <div className="chat__title"><strong>{widget?.name}</strong><span>{words.subtitle}</span></div>
      {onClose && <button type="button" className="chat__close" onClick={onClose} aria-label="Close chat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
    </header>
    <div className="chat__log" ref={log} role="log" aria-live="polite">
      {messages.map(message => <Message key={message.id} message={message} {...shared} />)}
      {messages.at(-1)?.kind === 'answer' && more.length > 0 && <div className="chat__more">
        <span>Other questions</span>
        <div className="chat__chips">{more.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
      </div>}
    </div>
    {readError && <p className="msg__error" role="alert" style={{ padding: '0 20px' }}>{readError}</p>}
    <form className="chat__form" onSubmit={submit} aria-busy={busy}>
      {suggestions.length > 0 && <ul className="chat__suggest" aria-label="Matching questions">
        {suggestions.map(faq => <li key={faq.id}><button type="button" onClick={() => showAnswer(faq, faq.question)}>{faq.question}</button></li>)}
      </ul>}
      <label className="visually-hidden" htmlFor="chat-question">Type your question</label>
      <input id="chat-question" ref={input} value={text} readOnly={busy} onChange={event => setText(event.target.value.slice(0, 500))} placeholder="Type your question…" autoComplete="off" enterKeyHint="send" />
      <button type="submit" className="chat__send" disabled={busy || !text.trim()} aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
    </form>
    <footer className="chat__foot"><a href="https://saygday.ai" target="_blank" rel="noopener">Made with SayGday.ai</a></footer>
  </div>
}

function Message({ message, widget, words, starters, showAnswer, add, preview, api, replaced, onSent }) {
  if (message.from === 'me') return <div className="msg msg--me"><p>{message.text}</p></div>
  if (message.kind === 'greeting') return <div className="msg msg--bot">
    <p>{widget?.greeting}</p>
    {starters.length > 0 ? <div className="chat__chips">{starters.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
      : <p className="msg__note">Type your question below and we’ll pass it to the team.</p>}
  </div>
  if (message.kind === 'answer') return <div className="msg msg--bot msg--answer">
    {message.askedAs && message.askedAs !== message.faq.question && <p className="msg__label">{message.faq.question}</p>}
    <p>{message.faq.answer}</p>
  </div>
  if (message.kind === 'text') return <div className="msg msg--bot"><p>{message.text}</p></div>
  if (message.kind === 'suggest') return <div className="msg msg--bot">
    <p>Is it one of these?</p>
    <div className="chat__chips">{message.options.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
    <button type="button" className="link-button" onClick={() => add({ from: 'bot', kind: 'ask', question: message.question })}>{words.askInstead}</button>
  </div>
  if (message.kind === 'ask') return replaced.has(message.id)
    ? <div className="msg msg--bot msg--handoff"><p>{words.handoff}</p></div>
    : <AskTeam message={message} words={words} preview={preview} api={api} onSent={onSent} />
  return null
}

// "That's one for Sam": the visitor's question goes to the business, with
// their email address if they leave one.
function AskTeam({ message, words, preview, api, onSent }) {
  const [email, setEmail] = useState(message.email || '')
  const [trap, setTrap] = useState('')
  const [state, setState] = useState('ready')
  const [done, setDone] = useState('')
  const [error, setError] = useState('')
  async function send(event, withEmail = true) {
    event.preventDefault()
    const address = withEmail ? email.trim() : ''
    if (withEmail && !EMAIL.test(address)) { setError('Check your email address, like you@example.com'); return }
    setError('')
    if (preview) { setState('done'); setDone('In this preview, questions aren’t sent. On your website, this goes to your inbox in SayGday.'); return }
    setState('sending')
    try {
      const result = await api.ask({ question: message.question, email: address || null, website: trap })
      setState('done')
      setDone(handoffConfirmation(result, address, words))
      onSent?.(message.id)
    } catch (failure) {
      setState('ready')
      setError(failure?.message || 'That didn’t send. Please try again.')
    }
  }
  const lead = message.email ? words.handoffWithEmail : words.handoff
  if (state === 'done') return <div className="msg msg--bot msg--handoff"><p className="sent">{TICK}{done}</p></div>
  return <div className="msg msg--bot msg--handoff">
    <p>{lead}</p>
    {message.quoted && <p className="msg__quote">“{message.question}”</p>}
    <form onSubmit={event => send(event, true)} noValidate>
      <div className="handoff__field">
        <label className="visually-hidden" htmlFor={`email-${message.id}`}>Your email</label>
        <input id={`email-${message.id}`} type="email" inputMode="email" autoComplete="email" placeholder="you@email.com" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(error)} />
        <button type="submit" className="chat__ask" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send'}</button>
      </div>
      <input className="visually-hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={event => setTrap(event.target.value)} />
      {error && <p className="msg__error" role="alert">{error}</p>}
      <p className="handoff__to">{ARROW}{words.inbox}</p>
      <button type="button" className="link-button" disabled={state === 'sending'} onClick={event => send(event, false)}>{words.noReply}</button>
    </form>
  </div>
}
