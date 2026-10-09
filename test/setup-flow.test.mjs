import assert from 'node:assert/strict'
import test from 'node:test'
import { SETUP_STEPS, setupFlow, setupPath, setupChecklist, chatReviewKey } from '../src/app/setup-flow.mjs'

const approved = [{ id: 'approved', status: 'approved' }]
const verified = { slug: 'our-shop', websiteVerifiedAt: '2026-10-09T10:00:00Z' }

test('new owners must approve an answer before advancing, without trusting the step URL', () => {
  for (const step of SETUP_STEPS.map(item => item.id)) {
    const flow = setupFlow({ step, business: verified, faqs: [{ status: 'draft' }] })
    assert.equal(flow.current, 'answers')
    assert.equal(flow.canContinue, false)
    assert.equal(flow.approved, 0)
  }
})

test('one approved answer can continue while unfinished drafts remain unpublished', () => {
  const flow = setupFlow({ step: 'answers', faqs: [...approved, { status: 'draft' }, { status: 'draft' }] })
  assert.equal(flow.canContinue, true)
  assert.equal(flow.approved, 1)
  assert.equal(flow.drafts, 2)
  assert.equal(flow.next, 'appearance')
})

test('preview and payment in setup require the selected business to be verified', () => {
  for (const step of ['preview', 'billing']) {
    const blocked = setupFlow({ step, business: { slug: 'new-shop' }, faqs: approved })
    assert.equal(blocked.current, 'verify')
    assert.equal(blocked.canContinue, false)
    const allowed = setupFlow({ step, business: verified, faqs: approved })
    assert.equal(allowed.current, step)
  }
  const switched = setupFlow({ step: 'billing', business: { slug: 'another-shop' }, faqs: approved })
  assert.equal(switched.current, 'verify', 'verification from a previous business does not carry across')
})

test('successful website verification unlocks preview, then the real billing step', () => {
  const check = setupFlow({ step: 'verify', business: verified, faqs: approved })
  assert.equal(check.canContinue, true)
  assert.equal(check.previous, 'install')
  assert.equal(check.next, 'preview')
  const preview = setupFlow({ step: 'preview', business: verified, faqs: approved })
  assert.equal(preview.next, 'billing')
  assert.equal(preview.nextLabel, 'Approve my chat & continue')
  const billing = setupFlow({ step: 'billing', business: verified, faqs: approved })
  assert.equal(billing.next, null)
  assert.equal(billing.canContinue, false, 'the wizard cannot grant activation or simulate a payment')
})

test('loading answers never enables progression and setup links retain the business', () => {
  const flow = setupFlow({ step: 'preview', business: verified, faqs: null })
  assert.equal(flow.loaded, false)
  assert.equal(flow.canContinue, false)
  assert.equal(setupPath('verify', 'a&business=other'), '/app/setup/verify?business=a%26business%3Dother')
  assert.equal(setupPath('not-a-step', 'shop'), '/app/setup/answers?business=shop')
  assert.equal(setupFlow({ step: 'not-a-step', faqs: approved }).current, 'answers')
})


test('the customer chooses appearance before installation and approves the finished preview immediately before billing', () => {
  assert.deepEqual(SETUP_STEPS.map(item => item.id), ['answers', 'appearance', 'install', 'verify', 'preview', 'billing'])
  const flow = setupFlow({ step: 'appearance', business: {}, faqs: approved })
  assert.equal(flow.previous, 'answers')
  assert.equal(flow.next, 'install')
  assert.equal(flow.canContinue, true)
})

test('completion ticks use evidence, never the current page or DNS proof as installation proof', () => {
  const get = data => Object.fromEntries(setupChecklist(data).map(item => [item.id, item]))
  const dns = get({ business: { ...verified, verifiedBy: 'dns' }, faqs: [...approved, { status: 'draft' }] })
  assert.equal(dns.answers.complete, true, 'new drafts do not erase approved answers')
  assert.equal(dns.install.complete, false)
  assert.equal(dns.verify.complete, true)
  assert.equal(dns.preview.complete, false)
  assert.equal(dns.appearance.complete, false, 'a default icon is ready, not a made-up completed action')
  const button = get({ business: { ...verified, verifiedBy: 'button' }, faqs: approved, previewApproved: true, billing: { state: 'trial', subscriptionScheduled: true } })
  assert.equal(button.install.complete, true)
  assert.equal(button.preview.complete, true)
  assert.equal(button.billing.complete, true)
  const cancelled = get({ billing: { state: 'trial', subscriptionScheduled: true, cancelAtPeriodEnd: true } })
  assert.equal(cancelled.billing.complete, false)
  assert.equal(cancelled.billing.status, 'Cancelled')
  assert.equal(get({ billing: { state: 'trial', subscriptionScheduled: false } }).billing.complete, false)
})

test('chat review belongs to the selected saved chat and is invalidated by customer-visible changes', () => {
  const business = { id: 'one', website: 'https://one.test', character: 'wally', buttonColour: '#31584a', greeting: 'Hi', signedBy: 'Sam' }
  const faqs = [{ id: 'a', status: 'approved', question: 'Where?', answer: 'Here', variants: [], featured: true }]
  const key = chatReviewKey(business, faqs)
  for (const changed of [{ id: 'two' }, { character: 'plus' }, { buttonColour: '#000000' }, { greeting: 'Hello' }, { signedBy: 'Jo' }, { website: 'https://two.test' }]) assert.notEqual(chatReviewKey({ ...business, ...changed }, faqs), key)
  assert.notEqual(chatReviewKey(business, [{ ...faqs[0], answer: 'There' }]), key)
  assert.equal(chatReviewKey(business, [...faqs, { id: 'draft', status: 'draft' }]), key)
  assert.equal(chatReviewKey(business, [{ ...faqs[0], views: 50 }]), key, 'view counts are not a content change')
  assert.equal(chatReviewKey(business, null), '')
})
