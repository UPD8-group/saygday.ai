import { useEffect, useMemo, useRef, useState } from 'react'
import { respond, typeahead } from '../../shared/matcher.mjs'
import { characterFor, characterImage, plainSvg } from '../../shared/characters.mjs'

// The chat on a business's website, and its preview in the dashboard. It
// only ever shows answers the business approved, word for word. A question it
// can't match is offered to the business's team, never guessed at.
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
let counter = 0
const key = () => `m${++counter}`

export function Avatar({ character, size = 40 }) {
  const found = characterFor(character)
  if (found) return <img className="chat-avatar" src={characterImage(found.key)} alt="" width={size} height={size} />
  // A plain button: one of the shapes in shared/characters.mjs (fixed markup,
  // never anything a business or visitor typed).
  return <span className="chat-avatar chat-avatar--bubble" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: plainSvg(character, Math.round(size * 0.5)) }} />
}

export default function Chat({ widget, preview = false, api = {}, onClose }) {
  const faqs = useMemo(() => widget?.faqs || [], [widget])
  const starters = useMemo(() => {
    const featured = faqs.filter(faq => faq.featured)
    return (featured.length ? featured : faqs).slice(0, 6)
  }, [faqs])
  const [messages, setMessages] = useState(() => [{ id: key(), from: 'bot', kind: 'greeting' }])
  const [text, setText] = useState('')
  const [asked, setAsked] = useState(() => new Set())
  const log = useRef(null)
  const input = useRef(null)
  const suggestions = useMemo(() => typeahead(text, faqs), [text, faqs])
  const context = { name: widget?.name || 'us' }

  useEffect(() => { log.current?.lastElementChild?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }, [messages])

  function add(...items) { setMessages(current => [...current.filter(item => item.kind !== 'typing'), ...items.map(item => ({ id: key(), ...item }))]) }

  function showAnswer(faq, askedAs) {
    setAsked(current => new Set(current).add(faq.id))
    add({ from: 'me', text: askedAs || faq.question }, { from: 'bot', kind: 'answer', faq })
    if (!preview) api.viewed?.(faq.id)
    setText('')
  }

  function submit(event) {
    event.preventDefault()
    const question = text.replace(/\s+/g, ' ').trim()
    if (!question) return
    setText('')
    const decision = respond(question, faqs, context)
    if (decision.kind === 'answer') return showAnswer(decision.entry, question)
    add({ from: 'me', text: question })
    if (decision.kind === 'smalltalk') return add({ from: 'bot', kind: 'text', text: decision.text })
    if (decision.kind === 'suggest') return add({ from: 'bot', kind: 'suggest', options: decision.options, question })
    add({ from: 'bot', kind: 'ask', question })
  }

  const more = starters.filter(faq => !asked.has(faq.id)).slice(0, 3)
  return <div className="chat" aria-label={`Questions for ${widget?.name || 'this business'}`}>
    <header className="chat__head">
      <Avatar character={widget?.character} />
      <div className="chat__title"><strong>{widget?.name}</strong><span>Answers from the {widget?.name} team</span></div>
      {onClose && <button type="button" className="chat__close" onClick={onClose} aria-label="Close chat"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
    </header>
    <div className="chat__log" ref={log} role="log" aria-live="polite">
      {messages.map(message => <Message key={message.id} message={message} widget={widget} starters={starters} showAnswer={showAnswer} add={add} preview={preview} api={api} />)}
      {messages.at(-1)?.kind === 'answer' && more.length > 0 && <div className="chat__more">
        <span>Other questions</span>
        <div className="chat__chips">{more.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
      </div>}
    </div>
    <form className="chat__form" onSubmit={submit}>
      {suggestions.length > 0 && <ul className="chat__suggest" aria-label="Matching questions">
        {suggestions.map(faq => <li key={faq.id}><button type="button" onClick={() => showAnswer(faq, faq.question)}>{faq.question}</button></li>)}
      </ul>}
      <label className="visually-hidden" htmlFor="chat-question">Type your question</label>
      <input id="chat-question" ref={input} value={text} onChange={event => setText(event.target.value.slice(0, 500))} placeholder="Type your question…" autoComplete="off" enterKeyHint="send" />
      <button type="submit" className="chat__send" disabled={!text.trim()} aria-label="Send"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
    </form>
    <footer className="chat__foot">Every answer here comes from {widget?.name}. <a href="https://saygday.ai" target="_blank" rel="noopener">SayGday</a></footer>
  </div>
}

function Message({ message, widget, starters, showAnswer, add, preview, api }) {
  if (message.from === 'me') return <div className="msg msg--me"><p>{message.text}</p></div>
  if (message.kind === 'greeting') return <div className="msg msg--bot">
    <p>{widget?.greeting}</p>
    {starters.length > 0 ? <div className="chat__chips">{starters.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
      : <p className="msg__note">Type your question below and we’ll pass it to the team.</p>}
  </div>
  if (message.kind === 'answer') return <div className="msg msg--bot msg--answer"><p className="msg__label">{message.faq.question}</p><p>{message.faq.answer}</p></div>
  if (message.kind === 'text') return <div className="msg msg--bot"><p>{message.text}</p></div>
  if (message.kind === 'suggest') return <div className="msg msg--bot">
    <p>Is it one of these?</p>
    <div className="chat__chips">{message.options.map(faq => <button key={faq.id} type="button" className="chip" onClick={() => showAnswer(faq)}>{faq.question}</button>)}</div>
    <button type="button" className="link-button" onClick={() => add({ from: 'bot', kind: 'ask', question: message.question })}>None of these. Ask the team</button>
  </div>
  if (message.kind === 'ask') return <AskTeam message={message} widget={widget} preview={preview} api={api} add={add} />
  if (message.kind === 'sent') return <div className="msg msg--bot msg--sent"><p>{message.text}</p></div>
  return null
}

function AskTeam({ message, widget, preview, api, add }) {
  const [email, setEmail] = useState('')
  const [trap, setTrap] = useState('')
  const [state, setState] = useState('ready')
  const [error, setError] = useState('')
  async function send(event, withEmail = true) {
    event.preventDefault()
    const address = withEmail ? email.trim() : ''
    if (withEmail && !EMAIL.test(address)) { setError('Check your email address, like you@example.com'); return }
    setError('')
    if (preview) { setState('done'); add({ from: 'bot', kind: 'sent', text: 'In this preview, questions aren’t sent. On your website, this goes to your inbox in SayGday.' }); return }
    setState('sending')
    try {
      await api.ask({ question: message.question, email: address || null, website: trap })
      setState('done')
      add({ from: 'bot', kind: 'sent', text: address ? `Thanks! We’ve sent your question to the ${widget.name} team. They’ll reply to ${address}.` : `Thanks! We’ve passed your question to the ${widget.name} team.` })
    } catch (failure) {
      setState('ready')
      setError(failure?.message || 'That didn’t send. Please try again.')
    }
  }
  if (state === 'done') return <div className="msg msg--bot"><p>We don’t have an answer for that one yet.</p></div>
  return <div className="msg msg--bot msg--ask">
    <p>We don’t have an answer for that one yet. Drop your email and we’ll send your question to the {widget?.name} team. They’ll email you back.</p>
    <form onSubmit={event => send(event, true)} noValidate>
      <label className="visually-hidden" htmlFor={`email-${message.id}`}>Your email</label>
      <input id={`email-${message.id}`} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={Boolean(error)} />
      <input className="visually-hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={trap} onChange={event => setTrap(event.target.value)} />
      <button type="submit" className="chat__ask" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send to the team'}</button>
      {error && <p className="msg__error" role="alert">{error}</p>}
      <button type="button" className="link-button" disabled={state === 'sending'} onClick={event => send(event, false)}>Just let them know. I don’t need a reply</button>
    </form>
  </div>
}
