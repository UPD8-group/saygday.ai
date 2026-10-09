// Setup progress is presentation only. Verification, checkout and public access
// continue to be decided by the server, never by the current URL or step.
export const SETUP_STEPS = Object.freeze([
  { id: 'answers', label: 'Check answers', nextLabel: 'Continue to installation' },
  { id: 'install', label: 'Add to website', nextLabel: 'Continue to verification' },
  { id: 'verify', label: 'Verify website', nextLabel: 'Continue to preview' },
  { id: 'preview', label: 'Preview your chat', nextLabel: 'Continue to payment' },
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
