// Setup progress is presentation only. Verification, checkout and public access
// continue to be decided by the server, never by the current URL or step.
export const SETUP_STEPS = Object.freeze([
  { id: 'answers', label: 'Check answers', nextLabel: 'Choose your chat icon' },
  { id: 'appearance', label: 'Choose appearance', nextLabel: 'Continue to installation' },
  { id: 'install', label: 'Add to website', nextLabel: 'Continue to verification' },
  { id: 'verify', label: 'Verify website', nextLabel: 'Continue to preview' },
  { id: 'preview', label: 'Approve your chat', nextLabel: 'Approve my chat & continue' },
  { id: 'billing', label: 'Add payment details', nextLabel: '' },
])

export function setupPath(step = 'answers', slug = '') {
  const known = SETUP_STEPS.some(item => item.id === step) ? step : 'answers'
  return `/app/setup/${known}${slug ? `?business=${encodeURIComponent(slug)}` : ''}`
}

export function setupFlow({ step = 'answers', business, faqs } = {}) {
  const loaded = Array.isArray(faqs)
  const approved = loaded ? faqs.filter(faq => faq.status === 'approved').length : 0
  const drafts = loaded ? faqs.filter(faq => faq.status === 'draft').length : 0
  const verified = Boolean(business?.websiteVerifiedAt)
  const requested = SETUP_STEPS.some(item => item.id === step) ? step : 'answers'
  let current = requested
  if (loaded && !approved && requested !== 'answers') current = 'answers'
  else if (loaded && !verified && ['preview', 'billing'].includes(requested)) current = 'verify'
  const index = SETUP_STEPS.findIndex(item => item.id === current)
  const canContinue = loaded && (current === 'answers' ? approved > 0 : current === 'verify' ? verified : current !== 'billing')
  return {
    loaded, approved, drafts, verified, current, index, canContinue,
    previous: SETUP_STEPS[index - 1]?.id || null,
    next: SETUP_STEPS[index + 1]?.id || null,
    nextLabel: SETUP_STEPS[index].nextLabel,
  }
}

// UI-only review: changing the selected business, appearance or approved answers
// invalidates the tick. This value never grants verification or billing access.
export function chatReviewKey(business, faqs) {
  if (!business || !Array.isArray(faqs)) return ''
  return JSON.stringify([business.id, business.website, business.character, business.buttonColour, business.greeting, business.signedBy,
    faqs.filter(item => item.status === 'approved').map(item => [item.id, item.question, item.answer, item.variants, item.featured]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])
}

export function setupChecklist({ business, faqs, billing, previewApproved = false, appearanceConfirmed = false } = {}) {
  const approved = Array.isArray(faqs) && faqs.some(item => item.status === 'approved')
  const installed = Boolean(business?.buttonSeenAt) || Boolean(business?.websiteVerifiedAt && business?.verifiedBy === 'button')
  const verified = Boolean(business?.websiteVerifiedAt)
  const cancelling = billing?.cancelAtPeriodEnd === true || ['canceling', 'canceled'].includes(billing?.state)
  const paidSetup = !cancelling && (billing?.state === 'active' || (['trial', 'trial_ending'].includes(billing?.state) && billing?.subscriptionScheduled === true))
  const details = {
    answers: [approved, approved ? 'Ready' : 'Review answers'],
    appearance: [appearanceConfirmed, appearanceConfirmed ? 'Chosen' : 'Ready to customise'],
    install: [installed, installed ? 'Code detected' : 'Add your code'],
    verify: [verified, verified ? 'Verified' : 'Check ownership'],
    preview: [previewApproved, previewApproved ? 'Approved' : 'Review your chat'],
    billing: [paidSetup, cancelling ? 'Cancelled' : paidSetup ? 'Activated' : billing?.state === 'internal' ? 'Not required' : 'Final step'],
  }
  return SETUP_STEPS.map(item => ({ ...item, complete: details[item.id][0], status: details[item.id][1] }))
}
