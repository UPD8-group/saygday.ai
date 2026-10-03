import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { chatWords, emailIn, questionFor, signerOf } from '../src/chat/words.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { widgetFor } from '../netlify/functions/_lib/visitor.mjs'

// The chat looks and talks like the example on saygday.ai's front page (owner,
// 3 October 2026: "Can we make it look like the one on the front screen? It
// just looks awesome, especially when somebody wants to inquire and add the
// email address"), and catches an email address typed into the question box
// (his screenshot: "Please message me …" got "Is it one of these? Can I
// change the greeting?").
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('every answer is signed off by name, and a new question is “one for” that person', () => {
  const sam = chatWords({ name: 'The Corner Pantry', signedBy: '  Sam ' })
  assert.equal(sam.signer, 'Sam')
  assert.equal(sam.subtitle, 'Answers from Sam and the team')
  assert.equal(sam.stamp, 'Signed off by Sam')
  assert.equal(sam.handoff, 'That’s one for Sam. Leave your email and Sam will get back to you.')
  assert.equal(sam.inbox, 'Goes straight to Sam’s inbox')
  assert.equal(sam.noReply, 'No reply needed? Just let Sam know')
  assert.equal(sam.askInstead, 'None of these. Ask Sam')
  assert.equal(sam.sent('jo@example.com'), 'Sent. Sam will reply to jo@example.com.')
  assert.equal(sam.passed, 'Passed on to Sam.')
  // No name given: the business is named, never a made-up person.
  const team = chatWords({ name: 'Joe’s Cafe', signedBy: null })
  assert.equal(team.signer, '')
  assert.equal(team.subtitle, 'Answers from the Joe’s Cafe team')
  assert.equal(team.stamp, 'Signed off by Joe’s Cafe')
  assert.equal(team.handoff, 'That’s one for the Joe’s Cafe team. Leave your email and they’ll get back to you.')
  assert.equal(team.inbox, 'Goes straight to the Joe’s Cafe team')
  assert.equal(team.sent('jo@example.com'), 'Sent. The Joe’s Cafe team will reply to jo@example.com.')
  assert.equal(signerOf({ signedBy: 42 }), '')
  for (const words of [sam, team]) assert.doesNotMatch(Object.values(words).filter(value => typeof value === 'string').join(' '), /\b(he|she|him|her|his|hers|himself|herself)\b/i, 'no guessing anyone’s pronouns')
})

test('an email address typed into the question box is found', () => {
  assert.equal(emailIn('Please message me jo@example.com'), 'jo@example.com')
  assert.equal(emailIn('my email is Jo.Bloggs+cafe@Example.com.au.'), 'jo.bloggs+cafe@example.com.au', 'a full stop ending the sentence isn’t part of it')
  assert.equal(emailIn('email me (jo@example.com) please'), 'jo@example.com')
  assert.equal(emailIn('reach me at "jo@example.com", thanks'), 'jo@example.com')
  for (const text of ['how much is it', 'jo at example dot com', 'jo@example', '@example.com', 'email me at jo@', '', null]) assert.equal(emailIn(text), null, String(text))
})

test('the address goes with the question the chat just offered to pass on', () => {
  const sent = new Set()
  const offered = [{ id: 'g', from: 'bot', kind: 'greeting' }, { id: 'q', from: 'me', text: 'Can I book for 12?' }, { id: 'a', from: 'bot', kind: 'ask', question: 'Can I book for 12?' }]
  assert.deepEqual(questionFor(offered, sent, 'jo@example.com'), { question: 'Can I book for 12?', replaces: 'a' }, 'the open offer, which the new one replaces')
  assert.deepEqual(questionFor(offered, new Set(['a']), 'jo@example.com'), { question: 'jo@example.com', replaces: null }, 'not one already sent')
  const suggested = [{ id: 'q', from: 'me', text: 'parking?' }, { id: 's', from: 'bot', kind: 'suggest', question: 'parking?', options: [] }]
  assert.deepEqual(questionFor(suggested, sent, 'email me jo@example.com'), { question: 'parking?', replaces: null })
  const answeredSince = [...offered, { id: 'm', from: 'me', text: 'price?' }, { id: 'b', from: 'bot', kind: 'answer' }]
  assert.deepEqual(questionFor(answeredSince, sent, 'Please message me jo@example.com'), { question: 'Please message me jo@example.com', replaces: null }, 'after an answer, the message is the question')
})

test('the owner names who signs off; the chat gets the name; an empty name takes it off', async () => {
  const pg = await database()
  const person = await user(pg, 'sam@cornerpantry.com.au')
  const db = rpcClient(pg, { user: person })
  const act = body => ownerAction({ request: new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: 'Bearer token' } }), db, body, origin: 'https://saygday.ai',
    dependencies: { startScan: async ({ website }) => ({ id: 'scan', status: 'queued', website }) } })
  const { business } = await act({ action: 'createBusiness', website: 'cornerpantry.com.au' })
  assert.equal(business.signedBy, null, 'none until the owner gives one')
  assert.equal((await act({ action: 'updateBusiness', signedBy: '  Sam  ' })).business.signedBy, 'Sam')
  assert.equal((await act({ action: 'updateBusiness', greeting: 'G’day!' })).business.signedBy, 'Sam', 'saving something else keeps it')
  await assert.rejects(act({ action: 'updateBusiness', signedBy: 'x'.repeat(41) }), error => error.status === 400)
  await db.rpc('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'button' })
  assert.equal((await widgetFor({ db, slug: business.slug, site: 'https://cornerpantry.com.au' })).signedBy, 'Sam', 'the chat signs every answer “Sam”')
  assert.equal((await act({ action: 'updateBusiness', signedBy: '' })).business.signedBy, null, 'an empty name takes it off')
  assert.equal((await widgetFor({ db, slug: business.slug, site: 'https://cornerpantry.com.au' })).signedBy, null)
})

test('the chat, its styles and the dashboard all play their part', async () => {
  const chat = await read('src/chat/Chat.jsx')
  assert.match(chat, /const email = emailIn\(question\)\n\s*if \(email\) \{[\s\S]*?\n\s*\}\n\s*const decision = respond\(question, faqs, context\)/, 'an email address is caught before any matching')
  assert.match(chat, /<SignOff words=\{words\} \/>/, 'every answer is signed off')
  assert.match(chat, /<span className="signoff__hand" aria-hidden="true">\{words\.signer\}<\/span>/)
  assert.match(chat, /<div className="handoff__field">[\s\S]*?type="email"[\s\S]*?<button type="submit" className="chat__ask"[^>]*>\{state === 'sending' \? 'Sending…' : 'Send'\}<\/button>/, 'the email field and Send side by side')
  assert.match(chat, /<p className="handoff__to">\{ARROW\}\{words\.inbox\}<\/p>/)
  assert.match(chat, /const \[email, setEmail\] = useState\(message\.email \|\| ''\)/, 'a typed address arrives filled in')
  assert.match(chat, /onClick=\{event => send\(event, false\)\}>\{words\.noReply\}/, 'and a visitor can still pass it on without one')
  const css = await read('src/chat/chat.css')
  assert.match(css, /\.msg--answer \{ background: var\(--c-mint\);/)
  assert.match(css, /\.msg--handoff \{ background: var\(--c-gold-soft\); border: 1px dashed var\(--c-gold\); \}/)
  assert.match(css, /\.signoff__hand \{ font: 600 26px\/1 var\(--c-hand\);/)
  assert.match(css, /--c-hand: 'Caveat',/)
  for (const page of ['chat.html', 'app.html']) assert.match(await read(page), /family=Caveat:wght@600/, `${page} loads the handwriting`)
  const button = await read('src/app/ChatButton.jsx')
  assert.match(button, /request\('updateBusiness', \{ character, greeting, signedBy: signedBy\.trim\(\) \}\)/)
  assert.match(button, /signedBy: signedBy\.trim\(\), faqs: live/, 'the preview signs off with the name as it’s typed')
})
