import assert from 'node:assert/strict'
import test from 'node:test'
import { database, rpcClient, user } from './helpers/database.mjs'
import { visitorAction } from '../netlify/functions/_lib/visitor.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'
import { processEnquiryNotifications } from '../netlify/functions/_lib/enquiry-notifications.mjs'
import { sendEnquiryNotification } from '../netlify/functions/_lib/email.mjs'

async function setup(t) {
  const pg = await database()
  const person = await user(pg, 'owner@cafe.com.au')
  const db = rpcClient(pg, { user: person })
  const rpc = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), error)
    return data
  }
  const business = await rpc('create_business', { p_user: person.id, p_email: person.email, p_website: 'https://cafe.com.au', p_name: 'Cafe' })
  await rpc('mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: 'dns' })
  const enqueue = (question = 'Can I book a table?') => rpc('ask_team_queued', {
    p_slug: business.slug, p_question: question, p_email: 'visitor@example.com',
    p_sender: 'SayGday <hello@saygday.ai>', p_public_url: 'https://saygday.ai',
  })
  return { pg, person, db, rpc, business, enqueue }
}

test('failed immediate email remains durable, reports pending, then a scheduled retry sends once', async t => {
  const { pg, person, db, rpc, business } = await setup(t)
  const response = await visitorAction({ db, body: { action: 'ask', business: business.slug, site: business.website,
    question: 'Can I book a table?', email: 'visitor@example.com' }, ip: '198.51.100.8',
    dependencies: { sendEnquiryEmail: async () => false } })
  assert.deepEqual(response, { ok: true, sent: false, notification: 'pending' })
  let page = await rpc('enquiries_page', { p_user: person.id })
  assert.equal(page.enquiries[0].emailed, false)
  assert.equal(page.enquiries[0].notification, 'pending')
  const [queued] = (await pg.query('select attempts, next_attempt_at > now() as backed_off from public.enquiry_notifications')).rows
  assert.equal(queued.attempts, 1); assert.equal(queued.backed_off, true)
  assert.deepEqual(await processEnquiryNotifications({ db, send: async () => assert.fail('must wait for backoff') }), [])
  await pg.exec("update public.enquiry_notifications set next_attempt_at = now() - interval '1 second'")
  let sent = 0
  const retry = await processEnquiryNotifications({ db, send: async () => { sent++; return { sent: true } } })
  assert.equal(retry[0].notification, 'sent'); assert.equal(sent, 1)
  page = await rpc('enquiries_page', { p_user: person.id })
  assert.equal(page.enquiries[0].emailed, true); assert.equal(page.enquiries[0].notification, 'sent')
  assert.deepEqual(await processEnquiryNotifications({ db, send: async () => assert.fail('must not send twice') }), [])
})

test('immediate request and scheduler cannot own the same lease; crashed leases recover, stale acknowledgements fail', async t => {
  const { pg, rpc, enqueue } = await setup(t)
  const enquiry = await enqueue()
  const [a, b] = await Promise.all([
    rpc('claim_enquiry_notifications', { p_id: enquiry.id }), rpc('claim_enquiry_notifications', {}),
  ])
  assert.equal(a.length + b.length, 1)
  const first = [...a, ...b][0]
  const message = { from: 'sender@example.com', to: ['owner@cafe.com.au'], text: 'Frozen original email' }
  assert.deepEqual(await rpc('prepare_enquiry_notification', { p_id: enquiry.id, p_lease: first.lease, p_message: message }), message)
  await pg.exec("update public.enquiry_notifications set lease_until = now() - interval '1 second'")
  const [second] = await rpc('claim_enquiry_notifications', { p_id: enquiry.id })
  assert.notEqual(second.lease, first.lease); assert.equal(second.attempt, 2)
  assert.deepEqual(second.enquiry, first.enquiry, 'retry content remains identical')
  assert.deepEqual(second.message, message)
  assert.deepEqual(await rpc('prepare_enquiry_notification', { p_id: enquiry.id, p_lease: second.lease,
    p_message: { ...message, text: 'Changed template in a later deployment' } }), message, 'a later template cannot rewrite a prepared message')
  assert.equal(await rpc('finish_enquiry_notification', { p_id: enquiry.id, p_lease: first.lease, p_sent: true }), null)
  assert.equal(await rpc('finish_enquiry_notification', { p_id: enquiry.id, p_lease: second.lease, p_sent: true }), 'sent')
})

test('permanent rejection stops retries; attempt and age limits stop sends before idempotency expires', async t => {
  const { pg, db, rpc, enqueue, person } = await setup(t)
  await enqueue('Permanent failure?')
  const permanent = await processEnquiryNotifications({ db, send: async () => ({ sent: false, retryable: false, code: 'EMAIL_HTTP_422' }) })
  assert.equal(permanent[0].notification, 'failed')
  assert.equal((await rpc('enquiries_page', { p_user: person.id })).enquiries[0].notification, 'failed')
  const exhausted = await enqueue('Exhausted retries?')
  await pg.query('update public.enquiry_notifications set attempts = 7 where enquiry_id = $1', [exhausted.id])
  assert.equal((await processEnquiryNotifications({ db, send: async () => ({ sent: false, retryable: true }) }))[0].notification, 'failed')
  const old = await enqueue('Scheduler outage?')
  await pg.query("update public.enquiry_notifications set created_at = now() - interval '23 hours' where enquiry_id = $1", [old.id])
  assert.deepEqual(await processEnquiryNotifications({ db, send: async () => assert.fail('never retry after key expiry') }), [])
  assert.equal((await pg.query('select status from public.enquiry_notifications where enquiry_id = $1', [old.id])).rows[0].status, 'failed')
})

test('retries freeze recipients, sender and body; network/429/5xx retry, provider 4xx stops', async t => {
  const { rpc, enqueue, person } = await setup(t)
  const saved = await enqueue()
  await rpc('update_business', { p_user: person.id, p_name: 'New name', p_notify_email: 'different@cafe.com.au' })
  const [job] = await rpc('claim_enquiry_notifications', { p_id: saved.id })
  const configuration = { configured: true, key: 'test-key', from: 'Changed <changed@saygday.ai>', publicUrl: 'https://changed.example.com' }
  const requests = []
  for (const status of [503, 429, 422, 200]) {
    const result = await sendEnquiryNotification({ enquiry: job.enquiry, configuration,
      fetchImpl: async (_url, init) => { requests.push(init); return new Response('{}', { status }) } })
    assert.equal(result.sent, status === 200)
    assert.equal(result.retryable, [503, 429].includes(status))
  }
  assert.ok(requests.every(r => r.headers['Idempotency-Key'] === `enquiry-${saved.id}`))
  assert.ok(requests.every(r => r.body === requests[0].body))
  const payload = JSON.parse(requests[0].body)
  assert.deepEqual(payload.to, ['owner@cafe.com.au']); assert.equal(payload.from, 'SayGday <hello@saygday.ai>')
  assert.ok(payload.text.includes('https://saygday.ai/app/asked')); assert.ok(!payload.text.includes('changed.example.com'))
  const network = await sendEnquiryNotification({ enquiry: job.enquiry, configuration, fetchImpl: async () => { throw new Error('network') } })
  assert.deepEqual(network, { sent: false, retryable: true, code: 'EMAIL_NETWORK' })
})

test('historical enquiries and enquiries without email are never swept into notifications', async t => {
  const { rpc, pg, db, business } = await setup(t)
  await rpc('ask_team', { p_slug: business.slug, p_question: 'A historical question?', p_email: 'old@example.com' })
  await rpc('ask_team_queued', { p_slug: business.slug, p_question: 'No reply needed?' })
  assert.equal((await pg.query('select count(*)::integer n from public.enquiry_notifications')).rows[0].n, 0)
  assert.deepEqual(await processEnquiryNotifications({ db, send: async () => assert.fail('no historical email') }), [])
})

test('status pagination finds old unanswered enquiries behind 300 done and walks equal timestamps without skips or duplicates', async t => {
  const { rpc, pg, person, business } = await setup(t)
  await pg.query(`insert into public.enquiries(business_id, question, status, created_at)
    select $1, 'Old unanswered question ' || i, 'new', now() - interval '1 day' from generate_series(1,125) i`, [business.id])
  await pg.query(`insert into public.enquiries(business_id, question, status)
    select $1, 'Completed question ' || i, 'done' from generate_series(1,300) i`, [business.id])
  const seen = new Set()
  let cursor = null, pages = 0
  do {
    const page = await rpc('enquiries_page', { p_user: person.id, p_status: 'new', p_limit: 50,
      p_before: cursor?.createdAt ?? null, p_before_id: cursor?.id ?? null })
    assert.deepEqual(page.counts, { new: 125, done: 300 })
    for (const item of page.enquiries) { assert.equal(item.status, 'new'); assert.ok(!seen.has(item.id)); seen.add(item.id) }
    cursor = page.nextCursor; pages++
  } while (cursor)
  assert.equal(seen.size, 125); assert.equal(pages, 3)
  const done = await rpc('enquiries_page', { p_user: person.id, p_status: 'done' })
  assert.equal(done.enquiries.length, 50); assert.ok(done.nextCursor)
  const rival = await user(pg)
  await rpc('create_business', { p_user: rival.id, p_email: rival.email, p_website: 'https://another.com.au' })
  const empty = await rpc('enquiries_page', { p_user: rival.id })
  assert.deepEqual(empty.enquiries, []); assert.deepEqual(empty.counts, { new: 0, done: 0 })
})

test('owner endpoint validates status and cursors while returning full counts', async t => {
  const { db, person } = await setup(t)
  const request = new Request('https://saygday.ai/api/app', { method: 'POST', headers: { authorization: 'Bearer token' } })
  const act = body => ownerAction({ db, request, body: { action: 'listEnquiries', ...body }, origin: 'https://saygday.ai' })
  assert.deepEqual(await act({}), { enquiries: [], nextCursor: null, counts: { new: 0, done: 0 } })
  for (const body of [{ status: 'all' }, { cursor: 'bad' }, { cursor: { createdAt: 'bad', id: person.id } }, { cursor: { createdAt: new Date().toISOString(), id: 'bad' } }])
    await assert.rejects(act(body), error => error.status === 400)
})
