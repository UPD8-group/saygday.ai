import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { OWN_ANSWERS, OWN_CHAT } from '../site/own-chat.mjs'
import { NOT_FOUND, OWN_BUTTON, PAGES, composePage } from '../site/chrome.mjs'
import { CHARACTERS, CHARACTER_KEYS, PLAIN_BUTTONS } from '../shared/characters.mjs'
import { findAnswer, respond, variantClashes } from '../shared/matcher.mjs'
import { hasButton } from '../netlify/functions/_lib/verify-website.mjs'
import { widgetFor } from '../netlify/functions/_lib/visitor.mjs'
import { HttpError } from '../netlify/functions/_lib/runtime.mjs'
import { ownChatSql } from '../scripts/own-chat-sql.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'

// SayGday's own chat on saygday.ai (owner, 3 October 2026: "put all the
// questions, more than 20, we'll really pack this thing out… use the G'day
// icon… put a pulse around it so somebody knows that it's there").
const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const ALL = [...PAGES, NOT_FOUND]
const built = async slug => composePage(await read(`site/${ALL.find(item => item.slug === slug).file}`), slug)
const words = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
const answer = question => {
  const found = OWN_ANSWERS.find(faq => faq.question === question)
  assert.ok(found, `an answer to “${question}”`)
  return found.answer
}

test('SayGday’s own chat: the G’day button, a pulse, and well over 20 answers the database will take', () => {
  assert.equal(OWN_CHAT.character, 'gday', 'the G’day plain button')
  assert.ok(CHARACTER_KEYS.includes(OWN_CHAT.character))
  assert.ok(OWN_CHAT.greeting.length <= 200)
  assert.ok(OWN_ANSWERS.length > 40, `${OWN_ANSWERS.length} answers`)
  const featured = OWN_ANSWERS.filter(faq => faq.featured)
  assert.equal(featured.length, 6, 'six buttons when the chat opens, the most a business can have')
  const seen = new Set()
  for (const faq of OWN_ANSWERS) {
    assert.ok(faq.question.trim().length >= 3 && faq.question.length <= 200, faq.question)
    assert.ok(faq.answer.trim().length >= 1 && faq.answer.length <= 1500, faq.question)
    assert.ok(faq.variants.length <= 12, `${faq.question}: at most twelve other ways to ask`)
    for (const variant of faq.variants) assert.ok(variant.length >= 3 && variant.length <= 200, variant)
    assert.ok(!seen.has(faq.question.toLowerCase()), `${faq.question} is asked once`)
    seen.add(faq.question.toLowerCase())
    assert.doesNotMatch(`${faq.question} ${faq.answer} ${faq.variants.join(' ')}`, /\bJay\b/, 'public copy names James')
  }
})

// Every fact the chat states is one the website (or the product) already
// states, so the chat and the pages can't disagree.
test('the chat’s facts are the website’s facts', async () => {
  const site = async slug => words(await built(slug))
  const facts = [
    ['How much does it cost?', 'A$30 a month', await site('pricing'), 'A$30 a month'],
    ['How much does it cost?', '14 days free', await site('pricing'), '14 days free'],
    ['Is there a free trial?', 'Build and preview without a card', await site('pricing'), 'No card needed to build and preview'],
    ['Is there a free trial?', 'add your card through Stripe to activate your chat', await site('pricing'), 'add your card through Stripe to activate your chat'],
    ['Is there a free trial?', 'charged automatically unless you cancel', await site('terms'), 'unless you cancel'],
    ['Is there a lock-in contract?', 'at least 30 days’ notice by email before any price change', await site('terms'), 'at least 30 days’ notice by email before any price change'],
    ['How long does it take to set up?', 'an hour or so', await site('getting-started'), 'An hour or so'],
    ['Can James set it up for me?', 'James does the first setups himself', await site('getting-started'), 'James does the first setups himself'],
    ['How do you write my questions and answers?', '20 to 25', await read('netlify/functions/_lib/scan.mjs'), 'draft 20 to 25 questions and answers'],
    ['How many questions and answers can I have?', 'up to 200', await read('supabase/migrations/20261002100000_saygday.sql'), '>= 200 then raise exception \'FAQ_LIMIT\''],
    ['How many questions and answers can I have?', 'up to six', await read('src/app/Questions.jsx'), 'featuredCount >= 6'],
    ['Can I choose which questions show first?', 'Tap Show first', await read('src/app/Questions.jsx'), '\'Show first\''],
    ['Can I try my chat before it goes live?', 'Try a question', await read('src/app/Questions.jsx'), 'Try a question</h2>'],
    ['What happens if the chat can’t answer a question?', 'Customers asked', await read('src/app/Asked.jsx'), '<h1>Customers asked</h1>'],
    ['What if I change my website?', 'stay exactly as they are', await read('src/app/Settings.jsx'), 'stay exactly as they are'],
    ['Does it work with Wix, WordPress, Squarespace or Shopify?', 'Business plan or higher', await read('src/app/ChatButton.jsx'), 'Business plan or higher'],
    ['Does it work on phones?', 'the chat opens full screen', await read('public/widget.js'), '@media (max-width:520px){.sg-panel{right:0;bottom:0;width:100vw'],
    ['Where is my data stored?', 'Supabase, in Sydney', await site('privacy'), 'Supabase stores our database, in Sydney'],
    ['Is my information used to train AI?', 'isn’t used to train their models', await site('privacy'), 'it isn’t used to train their models'],
    ['Does the chat use cookies?', 'doesn’t use cookies', await site('privacy'), 'The chat button on your website doesn’t use cookies'],
    ['Can I turn the chat off?', 'within 30 days', await site('privacy'), 'questions within 30 days'],
    ['How do I contact you?', 'within one business day, usually sooner', await site('contact'), 'within one business day, usually sooner'],
    ['Where are you based?', 'Civic Quarter 1, ', await site('contact'), 'Civic Quarter 1'],
    ['Where are you based?', '68 Northbourne Ave, Canberra ACT 2600', await site('contact'), '68 Northbourne Ave, Canberra ACT 2600'],
    ['Where are you based?', '37 702 004 608', await site('contact'), 'ABN 37 702 004 608'],
    ['Who’s behind SayGday?', '30 years working in customer service, across education, airlines, hospitality, media and transport', await site('story'), '30 years working in customer service, across education, airlines, hospitality, media and transport'],
    ['Who are Luna and Stormi?', 'two dogs', await read('site/story.html'), 'his two dogs, Luna and Stormi'],
    ['Can I choose what the button looks like?', 'eight Aussie locals', await site('meet-the-mob'), 'Eight Aussie locals'],
  ]
  assert.equal(CHARACTERS.length, 8, 'eight in the mob')
  assert.equal(PLAIN_BUTTONS.length, 12, 'and twelve plain buttons')
  assert.ok(answer('Can I choose what the button looks like?').includes('twelve plain buttons'))
  for (const [question, inAnswer, source, inSource] of facts) {
    assert.ok(answer(question).includes(inAnswer), `“${question}” says ${inAnswer}`)
    assert.ok(source.includes(inSource), `and so does its source: ${inSource}`)
  }
  for (const character of CHARACTERS) assert.ok(answer('Who are the mob?').includes(`${character.name} the ${character.animal}`), character.name)
})

// How visitors actually type, and the answer each should get, through the
// chat's own matcher (no AI).
const ASKS = [
  ['what is saygday', 'What is SayGday?'],
  ['what do you guys do', 'What is SayGday?'],
  ['whats this', 'What is SayGday?'],
  ['is this ai', 'Is this AI?'],
  ['is it AI?', 'Is this AI?'],
  ['are you a bot', 'Is this AI?'],
  ['r u a robot', 'Is this AI?'],
  ['am i talking to a real person', 'Is this AI?'],
  ['does it use chatgpt', 'Is this AI?'],
  ['is this chatgpt', 'Is this AI?'],
  ['how much', 'How much does it cost?'],
  ['how much does it cost', 'How much does it cost?'],
  ['price?', 'How much does it cost?'],
  ['whats the price', 'How much does it cost?'],
  ['how much per month', 'How much does it cost?'],
  ['what are your fees', 'How much does it cost?'],
  ['how much is saygday a month', 'How much does it cost?'],
  ['how do i pay', 'How much does it cost?'],
  ['how do i sign up', 'How do I get started?'],
  ['sign me up', 'How do I get started?'],
  ['how do i join', 'How do I get started?'],
  ['i want to get started', 'How do I get started?'],
  ['how to start', 'How do I get started?'],
  ['what if it doesnt know', 'What happens if the chat can’t answer a question?'],
  ['what happens when it cant answer', 'What happens if the chat can’t answer a question?'],
  ['where do questions go', 'What happens if the chat can’t answer a question?'],
  ['will i get an email when customers ask', 'What happens if the chat can’t answer a question?'],
  ['can you set it up for me', 'Can James set it up for me?'],
  ['can you help me set it up', 'Can James set it up for me?'],
  ['will you do the setup', 'Can James set it up for me?'],
  ['how does it work', 'How does SayGday work?'],
  ['how does saygday work?', 'How does SayGday work?'],
  ['how is it different to chatgpt', 'How is SayGday different from other chatbots?'],
  ['whats different about you', 'How is SayGday different from other chatbots?'],
  ['why should i choose saygday', 'How is SayGday different from other chatbots?'],
  ['does it make stuff up', 'Will it ever make something up?'],
  ['can it give wrong answers', 'Will it ever make something up?'],
  ['does it hallucinate', 'Will it ever make something up?'],
  ['does it learn', 'Does it learn from my customers’ chats?'],
  ['does it pretend to be human', 'Will customers think they’re talking to a person?'],
  ['why use ai', 'Why use AI at all?'],
  ['what is the ai used for', 'Why use AI at all?'],
  ['free trial?', 'Is there a free trial?'],
  ['is it free', 'Is there a free trial?'],
  ['can i try it free', 'Is there a free trial?'],
  ['how long is the trial', 'Is there a free trial?'],
  ['do i need a credit card', 'Is there a free trial?'],
  ['is there a contract', 'Is there a lock-in contract?'],
  ['lock in contract?', 'Is there a lock-in contract?'],
  ['can i cancel', 'Is there a lock-in contract?'],
  ['how do i cancel my subscription', 'Is there a lock-in contract?'],
  ['any hidden fees', 'What’s included in the price?'],
  ['what do i get', 'What’s included in the price?'],
  ['whats included', 'What’s included in the price?'],
  ['why so cheap', 'Why is it so cheap?'],
  ['how long does setup take', 'How long does it take to set up?'],
  ['how long to set up', 'How long does it take to set up?'],
  ['im not very technical', 'Do I need to be good with computers?'],
  ['is it easy', 'Do I need to be good with computers?'],
  ['do i need a developer', 'Do I need to be good with computers?'],
  ['what do i need', 'What do I need to get started?'],
  ['do i need a website', 'Do I need a website to use SayGday?'],
  ['i dont have a website', 'Do I need a website to use SayGday?'],
  ['can i use it on facebook', 'Do I need a website to use SayGday?'],
  ['how do i log in', 'How do I sign in?'],
  ['login', 'How do I sign in?'],
  ['do i need a password', 'How do I sign in?'],
  ['i didnt get my code', 'I didn’t get my sign-in code'],
  ['code not arriving', 'I didn’t get my sign-in code'],
  ['cant log in', 'I didn’t get my sign-in code'],
  ['where do the answers come from', 'How do you write my questions and answers?'],
  ['do you scan my site', 'How do you write my questions and answers?'],
  ['do i have to write the answers', 'How do you write my questions and answers?'],
  ['how many questions', 'How many questions and answers can I have?'],
  ['is there a limit', 'How many questions and answers can I have?'],
  ['can i edit answers', 'Can I change my answers?'],
  ['can i add my own questions', 'Can I change my answers?'],
  ['i changed my website', 'What if I change my website?'],
  ['can you rescan', 'What if I change my website?'],
  ['do you need my website password', 'What do you read on my website?'],
  ['can i choose the first questions', 'Can I choose which questions show first?'],
  ['can i test it first', 'Can I try my chat before it goes live?'],
  ['is there a demo', 'Can I see a demo?'],
  ['show me an example', 'Can I see a demo?'],
  ['what if customers spell it wrong', 'Do customers have to type the question exactly?'],
  ['typos?', 'Do customers have to type the question exactly?'],
  ['how do i install it', 'How do I add it to my website?'],
  ['where do i put the code', 'How do I add it to my website?'],
  ['does it work with squarespace', 'Does it work with Wix, WordPress, Squarespace or Shopify?'],
  ['does it work with wix', 'Does it work with Wix, WordPress, Squarespace or Shopify?'],
  ['wordpress?', 'Does it work with Wix, WordPress, Squarespace or Shopify?'],
  ['shopify', 'Does it work with Wix, WordPress, Squarespace or Shopify?'],
  ['why do i need to verify my website', 'Why do I have to prove I own my website?'],
  ['dns txt record', 'Why do I have to prove I own my website?'],
  ['my chat isnt showing', 'My chat button isn’t showing. What do I do?'],
  ['the button doesnt appear', 'My chat button isn’t showing. What do I do?'],
  ['will it slow my site', 'Will it slow down my website?'],
  ['does it work on mobile', 'Does it work on phones?'],
  ['does it work on my phone', 'Does it work on phones?'],
  ['can i change the icon', 'Can I choose what the button looks like?'],
  ['can i change the button', 'Can I choose what the button looks like?'],
  ['who are the mob', 'Who are the mob?'],
  ['what animals are there', 'Who are the mob?'],
  ['can i change the greeting', 'Can I change the greeting?'],
  ['do you sell my data', 'What do you do with my information?'],
  ['privacy', 'What do you do with my information?'],
  ['is my data safe', 'What do you do with my information?'],
  ['where is my data', 'Where is my data stored?'],
  ['is data kept in australia', 'Where is my data stored?'],
  ['do you train ai on my data', 'Is my information used to train AI?'],
  ['cookies?', 'Does the chat use cookies?'],
  ['can i see stats', 'Can I see which answers customers read?'],
  ['analytics', 'Can I see which answers customers read?'],
  ['is it monitored 24/7', 'Is someone watching the chat around the clock?'],
  ['what about emergencies', 'Is someone watching the chat around the clock?'],
  ['can it take bookings', 'Can customers book or pay through the chat?'],
  ['can customers pay in the chat', 'Can customers book or pay through the chat?'],
  ['how do i turn it off', 'Can I turn the chat off?'],
  ['delete my account', 'Can I turn the chat off?'],
  ['close my account', 'Can I turn the chat off?'],
  ['i have two websites', 'Can I use it on more than one website?'],
  ['multiple locations', 'Can I use it on more than one website?'],
  ['is it good for my business', 'What kinds of businesses is it for?'],
  ['does it suit cafes', 'What kinds of businesses is it for?'],
  ['is it good for a café', 'What kinds of businesses is it for?'],
  ['does it work with my website', 'Does it work with Wix, WordPress, Squarespace or Shopify?'],
  ['does it work in new zealand', 'Is SayGday only for Australian businesses?'],
  ['who are you', 'Who’s behind SayGday?'],
  ['who made this', 'Who’s behind SayGday?'],
  ['who is james', 'Who’s behind SayGday?'],
  ['who is luna', 'Who are Luna and Stormi?'],
  ['where are you located', 'Where are you based?'],
  ['whats your address', 'Where are you based?'],
  ['abn', 'Where are you based?'],
  ['are you australian', 'Where are you based?'],
  ['why the name saygday', 'Why is it called SayGday?'],
  ['how do i contact you', 'How do I contact you?'],
  ['phone number?', 'How do I contact you?'],
  ['email address', 'How do I contact you?'],
  ['can i speak to someone', 'How do I contact you?'],
  ['i need help', 'How do I contact you?'],
  ['what time do u shut on sat?', 'When are you open?'],
  ['opening hours', 'When are you open?'],
  ['are you open', 'When are you open?'],
]
// Never answered with confidence: they belong to someone else's chat, or to the team.
const NOT_OURS = ['do you have gluten free options', 'are dogs allowed', 'can i book a table for 12 on friday', 'what is the meaning of life']

// These previously selected one answer from incomplete/ambiguous word
// overlap. Keep every original case, but require the intended FAQ to remain
// available as an explicit choice instead of claiming the intent is certain.
const NEEDS_CONFIRMATION = new Set([
  'what happens when it cant answer', // "when" vs the approved "if" phrasing
  'how does it work', // equally fits operation and platform compatibility
  'how do i cancel my subscription', // subscription is an unapproved qualifier
  'do i have to write the answers', // drafting answers vs editing them
  'can i test it first', // "first" adds a condition not in the short variant
  'dns txt record', // DNS and TXT only occur in separate approved variants
  'why the name saygday', // the combined wording is not an approved variant
])

test('visitors find the right answer however they ask, and nothing finds the wrong one', () => {
  const entries = OWN_ANSWERS.map(faq => ({ ...faq }))
  for (const [asked, question] of ASKS) {
    if (!NEEDS_CONFIRMATION.has(asked)) assert.equal(findAnswer(asked, entries)?.question, question, `“${asked}”`)
    else {
      const decision = respond(asked, entries, { name: OWN_CHAT.name })
      assert.equal(decision.kind, 'suggest', `“${asked}” asks the visitor to choose`)
      assert.ok(decision.options.some(option => option.question === question), `“${asked}” still offers ${question}`)
    }
  }
  for (const asked of NOT_OURS) assert.equal(findAnswer(asked, entries), null, `“${asked}” goes to the team`)
  assert.deepEqual(variantClashes(entries).map(clash => `${clash.entry.question}: ${clash.phrasing} → ${clash.other.question}`), [], 'no other way of asking finds a different answer')
  assert.equal(respond('g’day', entries, { name: OWN_CHAT.name }).kind, 'smalltalk', 'a g’day gets a g’day back')
})

test('SayGday’s own chat does not confidently substitute a general answer for new intent', () => {
  for (const question of [
    'Does SayGday work with Wix?',
    'Does SayGday integrate with Xero?',
    'How do I update my opening hours?',
    'What time does my trial end?',
    'How much does it cost and does it work on Wix?',
  ]) assert.equal(findAnswer(question, OWN_ANSWERS), null, question)
  assert.equal(findAnswer('Does it work with Wix, WordPress, Squarespace or Shopify?', OWN_ANSWERS)?.question,
    'Does it work with Wix, WordPress, Squarespace or Shopify?', 'the exact approved question still wins')
})

test('the SQL sets SayGday up on the real schema, and running it again keeps the owner’s edits', async () => {
  const pg = await database()
  const db = rpcClient(pg)
  const call = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    return data
  }
  const owner = await user(pg, 'owner@example.com')
  assert.throws(() => ownChatSql('not-an-id'), /Usage/)
  await pg.exec(ownChatSql(owner.id))
  const business = await call('my_business', { p_user: owner.id })
  assert.equal(business.slug, 'saygday'); assert.equal(business.name, 'SayGday'); assert.equal(business.website, 'https://saygday.ai')
  assert.equal(business.character, 'gday'); assert.equal(business.notifyEmail, 'owner@example.com', 'questions go to the owner’s sign-in email, as for any business')
  assert.equal(business.signedBy, 'James', 'every answer signed off by James')
  assert.equal(business.counts.approved, OWN_ANSWERS.length); assert.equal(business.counts.featured, 6); assert.equal(business.counts.drafts, 0)
  assert.equal(business.websiteVerifiedAt, null, 'the website still has to pass the same check as everyone’s')
  assert.equal(await call('widget', { p_slug: 'saygday' }), null, 'so the chat stays hidden until then')

  await call('mark_website_verified', { p_slug: 'saygday', p_website: 'https://saygday.ai', p_method: 'button' })
  // The button on saygday.ai asks from saygday.ai itself, so the browser sends
  // no Origin: the page it names is the website.
  const chat = await widgetFor({ db, slug: 'saygday', seen: true, origin: null, site: 'https://saygday.ai' })
  assert.equal(chat.name, 'SayGday'); assert.equal(chat.character, 'gday'); assert.equal(chat.greeting, OWN_CHAT.greeting)
  assert.equal(chat.signedBy, 'James')
  assert.equal(chat.faqs.length, OWN_ANSWERS.length)
  assert.deepEqual(chat.faqs.slice(0, 6).map(faq => faq.question), OWN_ANSWERS.filter(faq => faq.featured).map(faq => faq.question), 'the six buttons, in order')
  assert.deepEqual(chat.faqs.find(faq => faq.question === 'Is this AI?').variants, OWN_ANSWERS.find(faq => faq.question === 'Is this AI?').variants)
  for (const [origin, site] of [['https://evil.example', 'https://saygday.ai'], [null, 'https://evil.example'], [null, null]])
    await assert.rejects(widgetFor({ db, slug: 'saygday', origin, site }), error => error instanceof HttpError && error.status === 404, `${origin} ${site}: a page elsewhere can’t borrow it`)

  const [first] = await call('list_faqs', { p_user: owner.id })
  await call('save_faq', { p_user: owner.id, p_id: first.id, p_question: first.question, p_answer: 'The owner’s own words.' })
  await pg.exec(ownChatSql(owner.id))
  const again = await call('list_faqs', { p_user: owner.id })
  assert.equal(again.length, OWN_ANSWERS.length, 'nothing doubled')
  assert.equal(again.find(faq => faq.id === first.id).answer, 'The owner’s own words.', 'an edited answer keeps the owner’s words')
})

test('every page carries the button, and saygday.ai’s home page passes the ownership check every business does', async () => {
  assert.equal(OWN_BUTTON, '<script src="https://saygday.ai/widget.js" data-business="saygday" data-pulse defer></script>')
  for (const item of ALL) {
    const html = await built(item.slug)
    assert.equal(html.split(OWN_BUTTON).length - 1, 1, `${item.file}: the button, once`)
    assert.ok(html.indexOf(OWN_BUTTON) > html.indexOf('</footer>'), `${item.file}: after the footer`)
  }
  assert.equal(hasButton(await built(''), 'saygday'), true, 'the home page shows its own button code')
  const widget = await read('public/widget.js')
  assert.match(widget, /var pulse = script\.getAttribute\('data-pulse'\) !== 'off'/, 'client sites and our own site pulse by default')
  assert.match(widget, /@media \(prefers-reduced-motion:reduce\)\{[^']*\.sg-button\.sg-pulse::before\{animation:none\}/, 'never for anyone who asks for less motion')
  assert.match(widget, /'&site=' \+ encodeURIComponent\(location\.origin\) \+ '&seen=1'/, 'the button names the page it’s on')
  assert.match(await read('src/site/site.css'), /body\.menu-open \[data-saygday\] \{ display: none; \}/, 'it steps aside for the menu')
  assert.match(await read('src/site/site.css'), /@media \(max-width: 1360px\) \{ \.site-foot \{ padding-bottom: 112px; \} \}/, 'and never covers the Acknowledgement of Country at the foot of a page')
})

