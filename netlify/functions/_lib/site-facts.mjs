// Carried over from the earlier SayGday platform (website-facts.mjs): drafts
// taken straight from the website's own sentences, used when the AI scan
// isn't available. Never invents anything: every answer is page text.
export const WEBSITE_DRAFT_TARGET = 15
export const compact = value => String(value || '').replace(/\s+/g, ' ').trim()

// These are discovery hints, not assertions about the business. A topic needs
// actual page text before it can become an answer; missing topics stay prompts.
const topics = [
  { key: 'hours', label: 'Opening hours', question: 'What are your opening hours?', match: text => /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekdays?|weekends?)\b/i.test(text) && /\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|closed|open)\b/i.test(text), score: text => /holiday/i.test(text) ? 2 : 1 },
  { key: 'location', label: 'Location', question: 'Where are you located?', match: text => /\b\d+[a-z]?\s+[\w’'-]+(?:\s+[\w’'-]+){0,3}\s+(?:street|st|road|rd|avenue|ave|lane|ln|drive|dr|parade|pde|crescent|cres|way)\b/i.test(text), score: text => /\b\d{4}\b/.test(text) ? 2 : 1 },
  { key: 'contact', label: 'Contact details', question: 'How can I contact you?', match: text => /[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?61|0)[\d ()-]{8,}/i.test(text), score: text => Number(text.includes('@')) + Number(/(?:\+?61|0)[\d ()-]{8,}/.test(text)) },
  { key: 'online', label: 'Online ordering', question: 'Can I shop online?', match: text => /\bonline\s+(?:shop|ordering|orders|store|shopping)\b/i.test(text) },
  { key: 'offerings', label: 'Products or services', question: 'What products or services do you offer?', match: text => /\b(?:we (?:offer|provide|make|sell)|services include|products|creates?|decorations|handcrafted|treatments?|repairs?|specialis[ez])\b/i.test(text) },
  { key: 'custom', label: 'Custom requests', question: 'Can I ask about a bespoke or custom creation?', match: text => /\b(?:bespoke|custom|personalised)\b/i.test(text), score: text => /\b(?:ask|contact|call|email|order)\b/i.test(text) ? 2 : 1 },
  { key: 'booking', label: 'Bookings', question: 'How do I make a booking?', match: text => /\b(?:bookings?|reservations?|appointments?)\b/i.test(text) },
  { key: 'prices', label: 'Prices or quotes', question: 'Where can I find prices or get a quote?', match: text => /\b(?:prices?|pricing|quotes?|costs?|fees)\b|\$\s?\d/i.test(text) },
  { key: 'delivery', label: 'Delivery', question: 'What delivery options are available?', match: text => /\b(?:delivery|deliveries|shipping|postage|we ship)\b/i.test(text) },
  { key: 'collection', label: 'Order collection', question: 'Can I collect my order?', match: text => /\b(?:click.and.collect|pick.?up|collect (?:your|an|my|the) order|order collection)\b/i.test(text) },
  { key: 'returns', label: 'Returns and refunds', question: 'What is your returns policy?', match: text => /\b(?:returns?|refunds?|exchanges?)\b/i.test(text) },
  { key: 'payments', label: 'Payment methods', question: 'How can I pay?', match: text => /\b(?:payment|pay by|cash|eftpos|credit cards?|debit cards?|afterpay)\b/i.test(text) },
  { key: 'accessibility', label: 'Accessibility', question: 'Is your venue accessible?', match: text => /\b(?:wheelchair|accessible|accessibility|step.free)\b/i.test(text) },
  { key: 'parking', label: 'Parking', question: 'Where can I park?', match: text => /\b(?:parking|car park)\b/i.test(text) },
  { key: 'pets', label: 'Pets', question: 'Can I bring my dog?', match: text => /\b(?:dogs?|pets?)\b/i.test(text) && /\b(?:welcome|allowed|friendly|permitted|outside|courtyard|only|not|no)\b/i.test(text) },
  { key: 'dietary', label: 'Dietary requirements', question: 'Can you cater for dietary requirements?', match: text => /\b(?:dietary|gluten.free|vegan|vegetarian|allergies|allergens)\b/i.test(text) },
  { key: 'gifts', label: 'Gift vouchers', question: 'Do you offer gift vouchers?', match: text => /\bgift (?:cards?|vouchers?|certificates?)\b/i.test(text) },
  { key: 'events', label: 'Events', question: 'Do you host events or workshops?', match: text => /\b(?:workshops?|private events?|host events?|upcoming events?)\b/i.test(text) },
  { key: 'service_area', label: 'Service area', question: 'Which areas do you serve?', match: text => /\b(?:service areas?|areas? we (?:serve|cover)|we (?:serve|cover)|servicing)\b/i.test(text) },
  { key: 'cancellations', label: 'Cancellations', question: 'How do cancellations work?', match: text => /\b(?:cancellations?|cancel (?:your|a|an)|reschedul)\b/i.test(text) },
]

// The standard question template: what customers of most small businesses ask.
export const STANDARD_TOPICS = Object.freeze(topics.map(({ key, label, question }) => Object.freeze({ key, label, question })))
export const KEY_TOPICS = Object.freeze(['hours', 'location', 'contact', 'offerings'])

function candidatesFor(page) {
  const sections = page.sections?.length ? page.sections : page.text.split(/(?<=[.!?])\s+(?=[A-Z])/).map(text => ({ text, heading: '' }))
  return sections.flatMap(section => {
    const text = compact(section.text), heading = compact(section.heading)
    // Keep short sections together (including qualifications). Long sections
    // contribute complete sentences only, never a cut-off price or condition.
    const excerpts = text.length <= 550 ? [text] : text.split(/(?<=[.!?])\s+(?=[A-Z])/)
    return excerpts.map(text => ({ text, heading, source_url: page.url }))
  }).filter(item => item.text.length >= 18 && item.text.length <= 550 && page.text.includes(item.text) &&
    !/^©|\b(?:all rights reserved|privacy policy|cookie policy|site by|website by)\b/i.test(item.text))
}

const duplicateAnswer = (entries, text) => entries.some(entry => {
  const a = compact(entry.answer).toLowerCase(), b = text.toLowerCase()
  return a.includes(b) || b.includes(a)
})

export function sourceWebsiteFacts(pages) {
  const candidates = pages.flatMap(candidatesFor), snippets = [], covered = new Set()
  for (const topic of topics) {
    const matches = candidates.filter(item => topic.match(item.text))
    if (matches.length) covered.add(topic.key)
    const candidate = matches.filter(item => !duplicateAnswer(snippets, item.text))
      .sort((a, b) => (topic.score?.(b.text) ?? b.text.length) - (topic.score?.(a.text) ?? a.text.length))[0]
    if (candidate) snippets.push({ question: topic.question, answer: candidate.text, source_url: candidate.source_url })
  }
  // Explicit website FAQs can cover useful subjects beyond the common topics.
  for (const candidate of candidates) {
    if (snippets.length >= 30) break
    if (!candidate.heading.endsWith('?') || candidate.heading.length > 180 || candidate.heading.length < 5 ||
        candidate.heading === candidate.text || duplicateAnswer(snippets, candidate.text) ||
        snippets.some(item => item.question.toLowerCase() === candidate.heading.toLowerCase())) continue
    snippets.push({ question: candidate.heading, answer: candidate.text, source_url: candidate.source_url })
  }
  const missingFacts = topics.filter(topic => KEY_TOPICS.includes(topic.key) && !covered.has(topic.key))
    .map(({ key, label, question }) => ({ key, label, question }))
  return { snippets, missingFacts }
}

