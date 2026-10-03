// What the chat says, and the one thing it reads out of a visitor's typing
// that isn't a question: an email address. Kept apart from Chat.jsx so the
// tests can hold it (test/chat-look.test.mjs).
//
// The chat looks and talks like the example on saygday.ai's front page (owner,
// 3 October 2026): it names who answers ("Answers from Sam and the team"), and
// a question it can't answer is "one for Sam", going "straight to Sam's
// inbox". A business that hasn't given a name is named instead. Answers carry
// no handwritten name or "Signed off by" stamp (owner, the same day: "please
// remove… also the Signed off by James", then "every client chat also").

export const signerOf = widget => (typeof widget?.signedBy === 'string' ? widget.signedBy.trim() : '')

export function chatWords(widget) {
  const name = widget?.name || 'this business'
  const signer = signerOf(widget)
  const team = `the ${name} team`
  return {
    signer,
    subtitle: signer ? `Answers from ${signer} and the team` : `Answers from ${team}`,
    handoff: signer ? `That’s one for ${signer}. Leave your email and ${signer} will get back to you.` : `That’s one for ${team}. Leave your email and they’ll get back to you.`,
    // The visitor typed their email address into the question box.
    handoffWithEmail: `Thanks! Tap Send and ${signer || team} will get back to you at this address.`,
    inbox: signer ? `Goes straight to ${signer}’s inbox` : `Goes straight to ${team}`,
    noReply: `No reply needed? Just let ${signer || 'them'} know`,
    askInstead: `None of these. Ask ${signer || 'the team'}`,
    sent: address => `Sent. ${signer || `The ${name} team`} will reply to ${address}.`,
    passed: `Passed on to ${signer || team}.`,
  }
}

// "please message me jo@joescafe.com.au" → "jo@joescafe.com.au". The address
// ends where an email address can't go on: a space, a bracket, a quote, or a
// full stop that ends the sentence.
const EMAIL_IN_TEXT = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[a-z]{2,}/i
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
export function emailIn(text) {
  const found = String(text ?? '').match(EMAIL_IN_TEXT)
  return found ? found[0].toLowerCase() : null
}

// The question an email address typed into the question box belongs to: the
// latest one the chat offered to pass on and hasn't sent yet, or else the
// typed message itself.
export function questionFor(messages, sent, typed) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.kind === 'ask' && !sent.has(message.id)) return { question: message.question, replaces: message.id }
    if (message.kind === 'suggest') return { question: message.question, replaces: null }
    if (message.from === 'bot' && (message.kind === 'answer' || message.kind === 'sent')) break
  }
  return { question: typed, replaces: null }
}
