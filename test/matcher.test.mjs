import assert from 'node:assert/strict'
import test from 'node:test'
import { tokenize, findAnswer, suggest, typeahead, smalltalk, respond, variantClashes } from '../shared/matcher.mjs'

// The first SayGday widget's matcher tests (test/matcher.test.mjs in the
// earlier platform), carried over with its sample cafe, plus the parts this
// version adds: suggestions while typing, one decision per typed question,
// and the dashboard's check that a variant can't find the wrong answer.
const entries = [
  { question: 'What are your opening hours?', answer: 'We’re open Monday to Friday 7am–4pm, and weekends 8am–3pm.', variants: ['when are you open', 'opening times', 'trading hours', 'what time do you open', 'are you open today'] },
  { question: 'Where are you located?', answer: 'You’ll find us at 12 Example Street, Bungendore NSW.', variants: ['what’s your address', 'whereabouts are you', 'how do i find you', 'location'] },
  { question: 'Do you take bookings?', answer: 'Yep! For groups of 6 or more we recommend booking.', variants: ['can i book a table', 'reservations', 'book a table', 'do you do reservations'] },
  { question: 'Do you have vegan options?', answer: 'We do: vegan and gluten-free options every day.', variants: ['vegan food', 'gluten free', 'dietary options', 'plant based'] },
  { question: 'Do you have parking?', answer: 'There’s free street parking right out front.', variants: ['where can i park', 'is there parking', 'car park'] },
]
const [hours, location, bookings, vegan, parking] = entries

test('tokenize drops stopwords and singularises', () => {
  assert.deepEqual(tokenize('What are your opening hours?'), ['open', 'open'])
  assert.deepEqual(tokenize('this is a thing'), [])
})

test('the exact question finds its answer', () => {
  assert.equal(findAnswer('What are your opening hours?', entries), hours)
  assert.equal(findAnswer('Do you take bookings?', entries), bookings)
})

test('variants find their answer', () => {
  assert.equal(findAnswer('trading hours', entries), hours)
  assert.equal(findAnswer('what’s your address', entries), location)
  assert.equal(findAnswer("what's your address", entries), location)
})

test('synonyms cover phrasings nobody listed', () => {
  assert.equal(findAnswer('when do you close', entries), hours)
  assert.equal(findAnswer('what time do you shut', entries), hours)
  assert.equal(findAnswer('directions to your place', entries), location)
  assert.equal(findAnswer('can I reserve a spot', entries), bookings)
})

test('one-letter typos still find the answer', () => {
  assert.equal(findAnswer('openning hours', entries), hours)
  assert.equal(findAnswer('whats your adress', entries), location)
  assert.equal(findAnswer('do you take bookkings', entries), bookings)
})

test('short real words are never mistaken for typos', () => {
  const withOven = entries.concat([{ question: 'Is the pizza oven wood-fired?', answer: 'Yes, wood-fired.', variants: [] }])
  assert.equal(findAnswer('do you have a pizza oven', withOven).answer, 'Yes, wood-fired.')
  assert.equal(findAnswer('can I change my booking', entries), bookings, '"change" never folds into price')
})

test('all-stopword questions fall back to the loose pass', () => {
  const priced = entries.concat([{ question: 'How much does a coffee cost?', answer: 'Flat whites are $4.50.', variants: ['how much', 'coffee prices'] }])
  assert.equal(findAnswer('how much', priced).answer, 'Flat whites are $4.50.')
})

test('gibberish and empty input find nothing', () => {
  assert.equal(findAnswer('xylophone quantum blockchain', entries), null)
  assert.equal(findAnswer('', entries), null)
  assert.equal(findAnswer('???', entries), null)
  assert.equal(findAnswer('anything', []), null)
})

test('near misses become suggestions, never a guessed answer', () => {
  const offered = suggest('do you have vegan cakes', entries)
  assert.ok(offered.includes(vegan))
  assert.ok(offered.length <= 3)
  assert.equal(suggest('xylophone quantum blockchain', entries).length, 0)
})

test('while typing, the matching approved questions are offered', () => {
  assert.deepEqual(typeahead('park', entries), [parking])
  assert.equal(typeahead('when are you op', entries)[0], hours)
  assert.equal(typeahead('veg', entries)[0], vegan)
  assert.deepEqual(typeahead('a', entries), [], 'one letter offers nothing')
  assert.deepEqual(typeahead('zzzz', entries), [])
  assert.ok(typeahead('do you', entries).length <= 4)
})

test('one decision per typed question', () => {
  const context = { name: 'Sample Cafe' }
  const answer = respond('trading hours?', entries, context)
  assert.equal(answer.kind, 'answer'); assert.equal(answer.entry, hours)
  assert.ok(!answer.more.includes(hours), 'the answer shown is not offered again')
  assert.equal(respond('g’day', entries, context).kind, 'smalltalk')
  assert.equal(respond('do you have vegan cakes', entries, context).kind, 'suggest')
  assert.deepEqual(respond('Can I hire the whole venue for a wedding?', entries, context), { kind: 'none' })
})

test('small talk greets, thanks and signs off, and never swallows a real question', () => {
  const context = { name: 'Sample Cafe' }
  assert.match(smalltalk("g'day", context), /Sample Cafe/)
  assert.match(smalltalk('thanks!', context), /No worries/)
  assert.match(smalltalk('bye', context), /Catch ya/)
  assert.match(smalltalk('are you a robot?', context), /approved by the Sample Cafe team/)
  assert.equal(smalltalk('what are your opening hours', context), null)
  assert.equal(smalltalk('thanks, and what time do you open?', context), null)
  assert.equal(smalltalk('hi there can I book a table for six people tonight', context), null)
})

test('every question and variant in the sample finds its own answer', () => {
  for (const entry of entries) {
    assert.equal(findAnswer(entry.question, entries), entry, entry.question)
    for (const variant of entry.variants) assert.equal(findAnswer(variant, entries), entry, variant)
  }
  assert.deepEqual(variantClashes(entries), [])
})

test('a variant that finds another answer is reported before it can show the wrong one', () => {
  const clashing = [hours, { ...parking, variants: [...parking.variants, 'opening times'] }]
  const clashes = variantClashes(clashing)
  assert.equal(clashes.length, 1)
  assert.equal(clashes[0].phrasing, 'opening times')
  assert.equal(clashes[0].other, hours)
})
