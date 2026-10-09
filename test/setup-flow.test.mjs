import assert from 'node:assert/strict'
import test from 'node:test'
import { SETUP_STEPS, setupFlow, setupPath } from '../src/app/setup-flow.mjs'

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
  assert.equal(flow.next, 'install')
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
  assert.equal(preview.nextLabel, 'Continue to payment')
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
