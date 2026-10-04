// Finding the approved answer a visitor is asking for, without AI.
//
// Ported from the first SayGday widget (public/faq.js in the earlier
// platform, with its tests), which matched questions entirely in the browser:
// stopwords dropped, plurals folded, common phrasings folded into one word
// ("trading hours", "when do you close" and "opening times" are the same
// thing), and a one-letter typo forgiven on longer words. Each entry is
// { question, answer, variants }: the variants are other ways customers ask the
// same thing, drafted by the website scan and editable by the owner.
//
// The chat never invents an answer: it shows an approved answer word for word,
// offers the closest approved questions to tap, or offers to pass the question
// to the business.

const STOP = new Set(('a an the is are am do does did can could will would you your youse u ur i we my me us it its there ' +
  'what whats how much many any please pls hey hi gday of for to in on at and or with about have has ' +
  'get got that these those thing this thi doe which should very really just').split(' '))
// Loose pass: only articles, for a question that is all stopwords ("how much").
const STOP_LOOSE = new Set(['a', 'an', 'the'])

const SYN = new Map()
for (const group of [
  ['open', 'opening', 'hour', 'time', 'trading', 'close', 'closed', 'closing', 'shut'],
  ['location', 'located', 'address', 'find', 'where', 'whereabout', 'direction'],
  ['book', 'booking', 'reservation', 'reserve', 'appointment'],
  ['price', 'cost', 'pricing', 'charge', 'fee', 'rate'],
  ['contact', 'call', 'ring'],
  ['park', 'parking', 'carpark'],
  ['kid', 'child', 'children', 'family'],
  ['pet', 'dog', 'puppy'],
  ['wifi', 'internet'],
  ['takeaway', 'takeout'],
  ['deliver', 'delivery', 'shipping', 'postage', 'ship'],
  ['pay', 'payment'],
  ['voucher', 'giftcard'],
  ['try', 'test'],
  ['something', 'stuff'],
]) for (const word of group) SYN.set(word, group[0])

// Real words one letter from a synonym that must never fold into it:
// "change" is not "charge", "contract" not "contact", "packing" not "parking".
const NOFOLD = new Set(['change', 'contract', 'packing'])

// True when two words are one letter apart (a typo: "openning", "adress").
export function within1(a, b) {
  if (a.length < b.length) [a, b] = [b, a]
  if (a.length - b.length > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (edits++) return false
    if (a.length === b.length) { i++; j++ } else i++
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

// Fold a word into its synonym group, forgiving a one-letter typo on words of
// six letters or more that start with the same letter, so short real words
// ("oven" and "open", "prize" and "price") are never mistaken for typos.
function canon(word) {
  if (SYN.has(word)) return SYN.get(word)
  if (word.length >= 6 && !NOFOLD.has(word)) {
    for (const [key, value] of SYN) if (key.length >= 6 && key[0] === word[0] && within1(word, key)) return value
  }
  return word
}

const singular = word => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word)
const words = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
const normalPhrase = text => words(text).join(' ')
const significant = word => word.length > 1 || /^\d+$/.test(word)
const NEGATION = new Set(['no', 'not', 'never', 'without', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'wont', 'wouldnt', 'shouldnt', 'havent', 'hasnt'])

// Used for scan deduplication, not for choosing a reply. Only equivalent
// whole questions count: no partial overlap, typo guesses, broad synonym
// groups or missing qualifiers. Keep numbers and negation, including one
// digit numbers. An uncertain duplicate is cheaper than losing a new fact.
export function isSameQuestion(a, b) {
  // Preserve order too: "from Sydney to Perth" is not "from Perth to Sydney".
  // The visitor stopwords are intentionally NOT reused: "how many" vs
  // "how", and "you" vs "I", can ask different questions when deduplicating.
  const filler = new Set(['a', 'an', 'the', 'please', 'pls', 'do', 'doe', 'can', 'could'])
  const tokens = text => words(text).map(singular).filter(word => (significant(word) || word === 'i') && !filler.has(word))
  const left = tokens(a), right = tokens(b)
  return left.length > 0 && left.length === right.length && left.every((word, index) => word === right[index])
}

export function tokenize(text, loose = false) {
  const stop = loose ? STOP_LOOSE : STOP
  const phrasing = loose ? text : String(text ?? '').replace(/\bi (?:want to|would like to|['’]d like to)\b/gi, '')
  const tokens = words(phrasing).map(singular).filter(word => significant(word) && !stop.has(word)).map(canon)
  // Generic placeholders in common questions add no new condition. Keep
  // every other noun, so "parking in Perth" and "booking for 12" stay specific.
  return loose ? tokens : tokens.filter(word => !(word === 'place' && tokens.includes('location')) && !(word === 'spot' && tokens.includes('book')))
}

function score(messageTokens, candidate, loose) {
  const cand = [...new Set(tokenize(candidate, loose))]
  const keys = [...new Set(messageTokens)]
  if (!keys.length || !cand.length) return { s: 0, overlap: 0, candLen: 99, eligible: false }
  const remaining = new Set(cand)
  let overlap = 0, matched = 0
  const unmatched = []
  for (const token of keys) {
    if (remaining.delete(token)) { overlap++; matched++ } else unmatched.push(token)
  }
  for (const token of unmatched) {
    // Numbers and negation are never typo-corrected. Match each candidate
    // word at most once: two near-misses cannot count as two known facts.
    if (token.length < 5 || /\d/.test(token) || NEGATION.has(token) || NOFOLD.has(token)) continue
    const found = [...remaining].find(word => word.length >= 5 && !/\d/.test(word) && !NEGATION.has(word) && !NOFOLD.has(word) && word[0] === token[0] && within1(token, word))
    if (found) { remaining.delete(found); overlap += 0.9; matched++ }
  }
  const protectedWords = tokens => tokens.filter(word => NEGATION.has(word) || /\d/.test(word)).sort().join(' ')
  // A general approved answer cannot establish a new location, date,
  // accessibility condition, payment method or second topic. Every content
  // word in the visitor's question must be supported by this one phrasing.
  return { s: 2 * overlap / (keys.length + cand.length), overlap, candLen: cand.length,
    eligible: matched === keys.length && protectedWords(keys) === protectedWords(cand) }
}

export const THRESHOLD = 0.6
// Below the confident threshold but above this: offered as "Did you mean…?"
export const SUGGEST_MIN = 0.3

const phrasings = entry => [entry.question, ...(Array.isArray(entry.variants) ? entry.variants : [])]

// Every entry scored against the message (its best phrasing wins), best
// first; ties go to more matched words, then the tighter phrasing, then the
// owner's order.
export function rank(message, entries) {
  const phrase = normalPhrase(message)
  let loose = false
  let tokens = tokenize(message)
  if (!tokens.length) { loose = true; tokens = tokenize(message, true) }
  if (!tokens.length) return []
  return entries.map((entry, index) => {
    let best = null
    for (const phrasing of phrasings(entry)) {
      const result = { ...score(tokens, phrasing, loose), exact: phrase === normalPhrase(phrasing) }
      if (!best || result.exact > best.exact || (result.exact === best.exact && (result.s > best.s || (result.s === best.s && (result.overlap > best.overlap || (result.overlap === best.overlap && result.candLen < best.candLen)))))) best = result
    }
    return { entry, ...best, index }
  }).sort((a, b) => Number(b.exact) - Number(a.exact) || b.s - a.s || b.overlap - a.overlap || a.candLen - b.candLen || a.index - b.index)
}

// The one approved answer the visitor is confidently asking for, or null.
export function findAnswer(message, entries) {
  const ranked = rank(message, entries)
  const [first, second] = ranked
  if (!first) return null
  if (first.exact) return second?.exact ? null : first.entry
  const [supported, alternative] = ranked.filter(result => result.eligible)
  if (!supported || supported.s < THRESHOLD) return null
  // Reordering or featuring FAQs must not decide between competing intents.
  if (alternative && supported.s - alternative.s < 0.12) return null
  return supported.entry
}

// Close, but not confident: up to three approved questions to offer.
export function suggest(message, entries, exclude = null) {
  return rank(message, entries)
    .filter(result => result.s >= SUGGEST_MIN && result.overlap >= 1 && result.entry !== exclude)
    .slice(0, 3)
    .map(result => result.entry)
}

// While the visitor types: approved questions that match what's typed so
// far, the last, unfinished word matched as the start of a word.
export function typeahead(text, entries, limit = 4) {
  const value = String(text ?? '')
  if (value.trim().length < 2) return []
  const all = words(value)
  const finished = /\s$/.test(value)
  const partial = finished ? '' : all.at(-1) || ''
  const complete = tokenize(finished ? value : all.slice(0, -1).join(' '))
  const results = []
  entries.forEach((entry, index) => {
    let best = 0
    for (const phrasing of phrasings(entry)) {
      const raw = words(phrasing).map(singular)
      const cand = new Set(tokenize(phrasing))
      let points = 0
      for (const token of complete) if (cand.has(token)) points++
      if (partial.length >= 2 && raw.some(word => word.startsWith(partial))) points += 0.8
      const needed = complete.length + (partial.length >= 2 ? 1 : 0)
      best = Math.max(best, needed ? points / needed : 0)
    }
    if (best >= 0.5) results.push({ entry, best, index })
  })
  return results.sort((a, b) => b.best - a.best || a.index - b.index).slice(0, limit).map(result => result.entry)
}

// A few pleasantries, checked only when no approved answer matched.
const SMALLTALK = [
  { re: /^(hi+|hey+|hiya|hello+|howdy|yo|g'?day( mate)?|good (morning|arvo|afternoon|evening))[\s!.?]*$/i,
    reply: ({ name }) => `G’day! What would you like to know about ${name}? Tap a question or type your own.` },
  { re: /^(thanks?( you)?( so much)?( mate)?|thank you( so much)?|cheers( mate)?|ta|legend|awesome([,! ]+thanks?)?|great([,! ]+thanks?)?|perfect)[\s!.?]*$/i,
    reply: () => 'No worries at all! Anything else you’d like to know?' },
  { re: /^(bye+|goodbye|see ya|see you|catch ya|laters?|gotta go)[\s!.?]*$/i,
    reply: () => 'Catch ya later. Pop back any time!' },
  { re: /^(who|what) are you[\s!.?]*$|^are you (a |an )?(robot|bot|ai|real( person)?|human)[\s!.?]*$/i,
    reply: ({ name }) => `I’m ${name}’s help desk. Every answer here was written or approved by the ${name} team. For anything else, I can pass your question to them.` },
]
export function smalltalk(message, context) {
  const text = String(message ?? '').replace(/[’‘]/g, "'").trim()
  if (!text || text.length > 40) return null
  const match = SMALLTALK.find(item => item.re.test(text))
  return match ? match.reply(context || { name: 'us' }) : null
}

// One decision for a typed question: an approved answer, close questions to
// offer, a pleasantry, or nothing (offer to ask the team).
export function respond(message, entries, context) {
  const answer = findAnswer(message, entries)
  if (answer) return { kind: 'answer', entry: answer, more: suggest(message, entries, answer).slice(0, 2) }
  const reply = smalltalk(message, context)
  if (reply) return { kind: 'smalltalk', text: reply }
  const options = suggest(message, entries)
  if (options.length) return { kind: 'suggest', options }
  return { kind: 'none' }
}

// For the dashboard: a variant that finds a different approved answer would
// show the wrong answer, so the owner is told before it goes live.
export function variantClashes(entries) {
  const clashes = []
  for (const entry of entries) {
    for (const phrasing of phrasings(entry)) {
      const ranked = rank(phrasing, entries)
      const found = findAnswer(phrasing, entries) || (ranked[0]?.exact && ranked[1]?.exact ? ranked[0].entry : null)
      if (found && found !== entry) clashes.push({ entry, phrasing, other: found })
    }
  }
  return clashes
}
