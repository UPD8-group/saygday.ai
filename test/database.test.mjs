import assert from 'node:assert/strict'
import test from 'node:test'
import { database, rpcClient, user } from './helpers/database.mjs'

// The whole data model against the real migration: one business per owner,
// owners only ever see their own rows, the chat only ever sees approved
// answers, and the browser roles can touch nothing.
async function setup() {
  const pg = await database()
  const db = rpcClient(pg)
  const call = async (name, args) => {
    const { data, error } = await db.rpc(name, args)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    return data
  }
  return { pg, db, call }
}
const rejects = (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message) || pattern.test(error.code || ''))

test('one business per owner, named from the website until the owner names it', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg, 'jo@joescafe.com.au')
  const business = await call('create_business', { p_user: owner.id, p_email: 'Jo@JoesCafe.com.au', p_website: 'https://www.joes-cafe.com.au/' })
  assert.equal(business.name, 'Joes Cafe')
  assert.equal(business.slug, 'joes-cafe')
  assert.equal(business.website, 'https://www.joes-cafe.com.au')
  assert.equal(business.notifyEmail, 'jo@joescafe.com.au')
  assert.equal(business.character, 'bubble')
  const again = await call('create_business', { p_user: owner.id, p_email: 'other@example.com', p_website: 'https://other.com.au', p_name: 'Other' })
  assert.equal(again.id, business.id, 'calling again returns the same business')
  assert.equal(again.website, 'https://www.joes-cafe.com.au')

  const second = await user(pg)
  const twin = await call('create_business', { p_user: second.id, p_email: second.email, p_website: 'https://joes-cafe.net', p_name: 'Joe’s Other Cafe' })
  assert.match(twin.slug, /^joes-cafe-[0-9a-f]{5}$/, 'a taken slug gets a short suffix')
  assert.equal(twin.name, 'Joe’s Other Cafe')

  for (const website of ['http://joes.com.au', 'https://localhost', 'joes.com.au', 'https://joes.com.au/menu', 'javascript:alert(1)', 'https://joes.com.au:8080'])
    await rejects(call('create_business', { p_user: (await user(pg)).id, p_email: 'a@b.co', p_website: website }), /INVALID_WEBSITE/)
  assert.equal(await call('my_business', { p_user: (await user(pg)).id }), null, 'no business yet')
})

test('questions and answers: add, edit, approve, feature up to six, and duplicates refused', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg)
  await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au' })
  const added = await call('save_faq', { p_user: owner.id, p_id: null, p_question: '  What are your  opening hours? ', p_answer: 'We’re open 7am to 3pm every day.', p_variants: ['when are you open', 'When are you open', 'x', 'What are your opening hours?', 'trading hours'] })
  assert.equal(added.question, 'What are your opening hours?')
  assert.equal(added.status, 'approved', 'what the owner types themselves is approved')
  assert.deepEqual(added.variants, ['when are you open', 'trading hours'], 'trimmed, deduplicated, never the question itself')
  await rejects(call('save_faq', { p_user: owner.id, p_id: null, p_question: 'what are your opening hours?', p_answer: 'Other' }), /23505/)

  const edited = await call('save_faq', { p_user: owner.id, p_id: added.id, p_question: null, p_answer: 'We’re open 7am to 4pm every day.' })
  assert.equal(edited.answer, 'We’re open 7am to 4pm every day.')
  assert.equal(edited.question, 'What are your opening hours?')

  const draft = await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'Do you have parking?', p_answer: 'Street parking out front.', p_status: 'draft' })
  await rejects(call('save_faq', { p_user: owner.id, p_id: draft.id, p_question: null, p_answer: null, p_featured: true }), /FEATURE_NEEDS_APPROVAL/)
  for (let index = 0; index < 6; index++) {
    const row = await call('save_faq', { p_user: owner.id, p_id: null, p_question: `Question number ${index}?`, p_answer: 'Yes.' })
    await call('save_faq', { p_user: owner.id, p_id: row.id, p_question: null, p_answer: null, p_featured: true })
  }
  await rejects(call('save_faq', { p_user: owner.id, p_id: added.id, p_question: null, p_answer: null, p_featured: true }), /FEATURED_LIMIT/)
  const featured = (await call('list_faqs', { p_user: owner.id })).filter(faq => faq.featured)
  assert.equal(featured.length, 6)
  const back = await call('save_faq', { p_user: owner.id, p_id: featured[0].id, p_question: null, p_answer: null, p_status: 'draft' })
  assert.equal(back.featured, false, 'an answer moved back to draft is no longer a button')
  assert.equal(await call('delete_faq', { p_user: owner.id, p_id: draft.id }), true)
  assert.equal((await call('my_business', { p_user: owner.id })).counts.drafts, 1)
})

test('approve all approves every draft and makes the first six the opening buttons', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg)
  await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au' })
  for (let index = 0; index < 8; index++) await call('save_faq', { p_user: owner.id, p_id: null, p_question: `Draft question ${index}?`, p_answer: 'An answer.', p_status: 'draft' })
  assert.equal(await call('approve_all', { p_user: owner.id }), 8)
  const faqs = await call('list_faqs', { p_user: owner.id })
  assert.equal(faqs.filter(faq => faq.status === 'approved').length, 8)
  assert.deepEqual(faqs.filter(faq => faq.featured).map(faq => faq.question), [0, 1, 2, 3, 4, 5].map(index => `Draft question ${index}?`))
})

test('an owner can never see or change another business’s answers or enquiries', async () => {
  const { pg, call } = await setup()
  const alice = await user(pg), bob = await user(pg)
  const shop = await call('create_business', { p_user: alice.id, p_email: alice.email, p_website: 'https://alice.com.au' })
  await call('create_business', { p_user: bob.id, p_email: bob.email, p_website: 'https://bob.com.au' })
  const faq = await call('save_faq', { p_user: alice.id, p_id: null, p_question: 'Do you deliver?', p_answer: 'Yes, within 5 km.' })
  await rejects(call('save_faq', { p_user: bob.id, p_id: faq.id, p_question: null, p_answer: 'Hacked' }), /NOT_FOUND/)
  assert.equal(await call('delete_faq', { p_user: bob.id, p_id: faq.id }), false)
  assert.deepEqual(await call('list_faqs', { p_user: bob.id }), [])
  const enquiry = await call('ask_team', { p_slug: shop.slug, p_question: 'Do you cater?', p_email: 'visitor@example.com' })
  assert.equal(await call('set_enquiry', { p_user: bob.id, p_id: enquiry.id, p_status: 'done' }), false)
  assert.equal(await call('delete_enquiry', { p_user: bob.id, p_id: enquiry.id }), false)
  assert.deepEqual(await call('list_enquiries', { p_user: bob.id }), [])
  assert.equal((await call('list_enquiries', { p_user: alice.id })).length, 1)
  const stranger = await user(pg)
  await rejects(call('list_faqs', { p_user: stranger.id }), /NO_BUSINESS/)
})

test('the chat only ever sees approved answers, featured ones first', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg)
  const business = await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au', p_name: 'The Cafe' })
  await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'Is this a draft?', p_answer: 'Unchecked words.', p_status: 'draft' })
  const one = await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'Where are you?', p_answer: '1 Main St.' })
  const two = await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'When are you open?', p_answer: '7am to 3pm.' })
  await call('save_faq', { p_user: owner.id, p_id: two.id, p_question: null, p_answer: null, p_featured: true })
  const widget = await call('widget', { p_slug: business.slug })
  assert.equal(widget.name, 'The Cafe')
  assert.deepEqual(widget.faqs.map(faq => faq.question), ['When are you open?', 'Where are you?'])
  assert.ok(!JSON.stringify(widget).includes('Unchecked words'), 'a draft never reaches the chat')
  assert.ok(!('notifyEmail' in widget) && !JSON.stringify(widget).includes(owner.email), 'the owner’s email never reaches the chat')
  assert.equal(await call('widget', { p_slug: 'no-such-business' }), null)
  assert.equal(await call('faq_viewed', { p_slug: business.slug, p_faq: one.id }), true)
  assert.equal((await call('list_faqs', { p_user: owner.id })).find(faq => faq.id === one.id).views, 1)
  assert.equal(await call('button_seen', { p_slug: business.slug }), true)
  assert.equal(await call('button_seen', { p_slug: business.slug }), false, 'at most once an hour')
})

test('a question the chat couldn’t answer reaches the business, with or without an email', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg, 'owner@cafe.com.au')
  const business = await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au' })
  const withEmail = await call('ask_team', { p_slug: business.slug, p_question: '  Can I book   the back room? ', p_email: ' Visitor@Example.com ' })
  assert.equal(withEmail.notifyEmail, 'owner@cafe.com.au')
  assert.equal(withEmail.email, 'visitor@example.com')
  assert.equal(withEmail.question, 'Can I book the back room?')
  await call('ask_team', { p_slug: business.slug, p_question: 'Do you sell gift cards?' })
  await rejects(call('ask_team', { p_slug: business.slug, p_question: 'Hello?', p_email: 'not-an-email' }), /23514/)
  await rejects(call('ask_team', { p_slug: 'missing', p_question: 'Hello?' }), /NOT_FOUND/)
  assert.equal(await call('enquiry_emailed', { p_id: withEmail.id }), true)
  const inbox = await call('list_enquiries', { p_user: owner.id })
  assert.deepEqual(inbox.map(item => [item.question, item.email, item.emailed]), [['Do you sell gift cards?', null, false], ['Can I book the back room?', 'visitor@example.com', true]])
  assert.equal((await call('my_business', { p_user: owner.id })).counts.newEnquiries, 2)
  assert.equal(await call('set_enquiry', { p_user: owner.id, p_id: withEmail.id, p_status: 'done' }), true)
  assert.equal((await call('my_business', { p_user: owner.id })).counts.newEnquiries, 1)
})

test('a scan runs once, saves drafts, skips questions the business has, and a re-scan keeps the owner’s work', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg)
  await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au' })
  await call('save_faq', { p_user: owner.id, p_id: null, p_question: 'Do you have parking?', p_answer: 'My own words.' })
  const scan = await call('start_scan', { p_user: owner.id, p_website: 'https://Cafe.com.au/' })
  assert.equal(scan.status, 'queued'); assert.equal(scan.started, true)
  const same = await call('start_scan', { p_user: owner.id, p_website: 'https://cafe.com.au' })
  assert.equal(same.id, scan.id); assert.equal(same.started, false, 'the scan already running is returned')

  const claimed = await call('claim_scan', { p_scan: scan.id })
  assert.equal(claimed.business.website, 'https://cafe.com.au')
  assert.equal(await call('claim_scan', { p_scan: scan.id }), null, 'claimed exactly once')
  const entries = [
    { question: 'When are you open?', answer: '7am to 3pm every day.', variants: ['opening hours', 'trading hours'], source_url: 'https://cafe.com.au/' },
    { question: 'Do you have parking?', answer: 'Scanned words.', variants: [] },
    { question: 'Where are you?', answer: '1 Main St.', variants: ['address'] },
    { question: 'x', answer: 'too short a question' },
  ]
  assert.equal(await call('finish_scan', { p_scan: scan.id, p_entries: entries, p_pages: 4 }), 2)
  const after = await call('latest_scan', { p_user: owner.id })
  assert.equal(after.status, 'done'); assert.equal(after.drafted, 2); assert.equal(after.pages, 4)
  let faqs = await call('list_faqs', { p_user: owner.id })
  assert.equal(faqs.find(faq => faq.question === 'Do you have parking?').answer, 'My own words.', 'an existing question is never overwritten')
  const hours = faqs.find(faq => faq.question === 'When are you open?')
  assert.equal(hours.status, 'draft'); assert.equal(hours.source, 'scan'); assert.deepEqual(hours.variants, ['opening hours', 'trading hours'])

  // The owner edits one draft and approves nothing; a re-scan replaces only the untouched draft.
  const where = faqs.find(faq => faq.question === 'Where are you?')
  await new Promise(resolve => setTimeout(resolve, 5))
  await call('save_faq', { p_user: owner.id, p_id: where.id, p_question: null, p_answer: '1 Main Street, Canberra.' })
  await pg.query("update public.scans set created_at = now() - interval '1 hour'")
  const rescan = await call('start_scan', { p_user: owner.id, p_website: 'https://cafe.com.au' })
  assert.notEqual(rescan.id, scan.id)
  await call('claim_scan', { p_scan: rescan.id })
  assert.equal(await call('finish_scan', { p_scan: rescan.id, p_entries: [{ question: 'Do you do takeaway?', answer: 'Yes.' }], p_pages: 3 }), 1)
  faqs = await call('list_faqs', { p_user: owner.id })
  assert.deepEqual(faqs.map(faq => faq.question).sort(), ['Do you do takeaway?', 'Do you have parking?', 'Where are you?'])
  assert.equal(faqs.find(faq => faq.question === 'Where are you?').answer, '1 Main Street, Canberra.')
})

test('a scan stops if the website changes, a stale scan reads as failed, and six a day is the limit', async () => {
  const { pg, call } = await setup()
  const owner = await user(pg)
  await call('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://cafe.com.au' })
  const first = await call('start_scan', { p_user: owner.id, p_website: 'https://cafe.com.au' })
  await call('claim_scan', { p_scan: first.id })
  const second = await call('start_scan', { p_user: owner.id, p_website: 'https://newcafe.com.au' })
  assert.notEqual(second.id, first.id)
  assert.equal(await call('finish_scan', { p_scan: first.id, p_entries: [{ question: 'Old site?', answer: 'Yes.' }], p_pages: 1 }), null, 'the replaced scan saves nothing')
  assert.deepEqual(await call('list_faqs', { p_user: owner.id }), [])
  await pg.query("update public.scans set updated_at = now() - interval '20 minutes' where id = $1", [second.id])
  const stale = await call('latest_scan', { p_user: owner.id })
  assert.equal(stale.status, 'failed'); assert.match(stale.error, /too long/)
  for (let index = 0; index < 4; index++) {
    await pg.query("update public.scans set status = 'done'")
    await call('start_scan', { p_user: owner.id, p_website: 'https://cafe.com.au' })
  }
  await pg.query("update public.scans set status = 'done'")
  await rejects(call('start_scan', { p_user: owner.id, p_website: 'https://cafe.com.au' }), /SCAN_LIMIT/)
})

test('the browser roles can call nothing and read nothing', async () => {
  const { pg } = await setup()
  const tables = (await pg.query(`select table_name, has_table_privilege('anon', 'public.' || table_name, 'select') as anon,
      has_table_privilege('authenticated', 'public.' || table_name, 'select') as signed_in
    from information_schema.tables where table_schema = 'public'`)).rows
  assert.ok(tables.length >= 5)
  for (const row of tables) assert.deepEqual([row.anon, row.signed_in], [false, false], row.table_name)
  const functions = (await pg.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as signed_in, has_function_privilege('service_role', p.oid, 'execute') as server
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`)).rows
  assert.ok(functions.length >= 25)
  for (const row of functions) assert.deepEqual([row.anon, row.signed_in, row.server], [false, false, true], row.proname)
  const rls = (await pg.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")).rows
  for (const row of rls) assert.equal(row.relrowsecurity, true, row.relname)
})
