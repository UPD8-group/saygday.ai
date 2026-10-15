// The owner's final offer supersedes the archived A$99 writing proposal.
// Render at build time inside the existing page components, never by swapping
// text after page load. This module is shared by live and review routes.
import { PREVIEW_SLUGS, applyApprovedCopy } from './content-preview.mjs'

export const CURRENT_OFFERS = Object.freeze({
  currency: 'AUD', selfManagedMonthly: 5900, managedMonthly: 7500,
  selfManagedPriceId: 'price_1UQwkRR8qEoKoynxsgmnPqqX',
  managedPriceId: 'price_1UQwoQR8qEoKoynxsA2ojHYu',
  trialDays: 7, dailyComparisonDays: 30,
})

export function publishSiteCopy(html, slug) {
  if (typeof html !== 'string' || typeof slug !== 'string') throw new TypeError('HTML and a page slug are required')
  let out = PREVIEW_SLUGS.includes(slug) ? applyApprovedCopy(html, slug) : html
  // Apply shared offer wording to legal/utility pages as well as sales pages.
  out = out
    .replaceAll('A$99', 'A$75')
    .replaceAll('7 days free. Card required. Then A$30/month.', 'A$59 self-managed. A$75 with hands-on support.')
    .replaceAll('7 days free. Card required to activate. Then A$30/month AUD automatically unless you cancel.', 'Have a week on us. Card required to activate 7 free days. Then A$59/month automatically unless you cancel.')
    .replaceAll('Try 7 days free', 'Build my SayGday')
    .replaceAll('Start your free 7 days', 'Build my SayGday')
    .replaceAll('A$30', 'A$59')
    .replaceAll('These are the proposed offers for new customers. Existing agreed prices, subscriptions and saved trial dates are not changed by this proposal.', 'These offers are for new customers. Existing customers keep their agreed prices, subscriptions and saved trial dates.')
  if (slug === 'pricing') {
    const amount = '<div class="price__amount">A$75<small>a month</small></div>'
    if (!out.includes(amount)) throw new Error('Managed price card is missing')
    out = out.replace(amount, `${amount}\n          <p>About A$2.50 a day, billed A$75 monthly. Daily comparison based on a 30-day month.</p>`)
  }
  if (slug === 'terms') {
    const clause = '<li><h3>Price and free days</h3><p>'
    const closing = 'We’ll give you at least 30 days’ notice by email before any price change.</p></li>'
    if (!out.includes(clause) || !out.includes(closing)) throw new Error('Pricing terms source changed')
    out = out.replace(clause, `${clause}The following A$59 self-managed and A$75 Managed offers apply to new customers from 16 October 2026. Existing customers retain their agreed prices, subscriptions and saved trial dates; publishing these offers does not change their existing agreements. </p><p>`)
      .replace(closing, 'We’ll give you at least 30 days’ notice by email before any price change.</p><p>SayGday Managed is A$75/month AUD for one business and one supported website. It includes the software, initial preparation of up to 20 short questions and answers, standard installation and initial checks, plus up to 20 minutes of content work each month for review and small answer updates. Your business approves the answers. Unused monthly content time does not roll over. Additional work is quoted separately. We agree website compatibility, scope and the start date before payment. The self-managed software free week does not include Managed setup work.</p></li>')
      .replace('Last updated 9 October 2026.', 'New-customer pricing updated 16 October 2026. Existing agreements remain unchanged.')
  }
  return out
}
