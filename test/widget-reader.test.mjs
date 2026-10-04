import test from 'node:test'
import assert from 'node:assert/strict'
import { createWidgetReader, currentFaq, handoffConfirmation } from '../src/chat/widget-reader.mjs'
import { chatWords } from '../src/chat/words.mjs'

test('an already-open chat reads an edited answer and stops offering a deleted answer', async () => {
  let published = { faqs: [{ id: 'hours', question: 'Hours?', answer: '9–5' }] }
  const read = createWidgetReader(async () => structuredClone(published))
  const old = await read()
  published.faqs[0].answer = 'Closed today'
  assert.equal(currentFaq(await read(), 'hours').answer, 'Closed today')
  assert.equal(currentFaq(old, 'hours').answer, '9–5', 'history is a snapshot')
  published.faqs = []
  assert.equal(currentFaq(await read(), 'hours'), null)
})

test('refresh failure cannot reuse a previously approved answer and a later retry recovers', async () => {
  let failure = false
  const read = createWidgetReader(async () => {
    if (failure) throw new Error('offline')
    return { faqs: [{ id: 'one', answer: 'Approved' }] }
  })
  await read()
  failure = true
  await assert.rejects(read(), /offline/)
  failure = false
  assert.equal((await read()).faqs.length, 1)
})

test('concurrent refreshes share their request but later questions fetch again', async () => {
  let calls = 0
  const read = createWidgetReader(async () => { calls++; return { faqs: [] } })
  await Promise.all([read(), read()])
  assert.equal(calls, 1)
  await read()
  assert.equal(calls, 2)
})

test('handoff copy only calls an email sent when the provider accepted it', () => {
  const words = chatWords({ name: 'Cafe', signedBy: 'Sam' })
  assert.match(handoffConfirmation({ notification: 'sent' }, 'jo@example.com', words), /^Sent\./)
  assert.match(handoffConfirmation({ notification: 'pending' }, 'jo@example.com', words), /saved.*waiting to send/)
  assert.match(handoffConfirmation({ notification: 'failed' }, 'jo@example.com', words), /saved.*couldn’t email/)
  assert.match(handoffConfirmation({ sent: false }, 'jo@example.com', words), /saved.*couldn’t email/)
  assert.match(handoffConfirmation({ notification: 'not_requested' }, '', words), /saved/)
})
