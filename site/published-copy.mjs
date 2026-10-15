// Current offer: one self-service SayGday plan, with a separate oo.studio
// website service. Earlier copy proposals are a writing bank, not live offers.
// Render once at build time in the existing components; never swap prices in
// the browser or use public offer text to override an existing billing account.
import { PREVIEW_SLUGS, applyApprovedCopy } from './content-preview.mjs'

export const CURRENT_OFFERS = Object.freeze({
  currency: 'AUD', selfManagedMonthly: 3000,
  selfManagedPriceId: 'price_1UOA0sR8qEoKoynxWAoOrDeA',
  trialDays: 7,
  studioMonthly: 6000,
  studioUrl: 'https://oo.studio/#plan',
  studioIncludesSayGday: true,
})

const TICK = '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ticks = items => items.map(item => `<li>${TICK}<span>${item}</span></li>`).join('\n')
const STUDIO_LINK = '<a href="https://oo.studio/#plan">Explore the oo.studio plan</a>'

// Owner's pricing story: affordable on purpose, with the customer's decision
// at its heart. Keep this copy concise enough for the existing mobile hero.
export const PRICING_STORY = Object.freeze({
  headline: 'Spare change.<br><em>On purpose.</em>',
  introduction: 'With the cost of living putting pressure on small businesses, a more helpful website shouldn’t mean another big bill. For A$30 a month, SayGday helps customers find your answers, understand what you offer and feel more confident choosing your business.',
  reason: 'Running a small business is expensive enough. We wanted SayGday to be something you can add to the website you already have, without taking on another big monthly bill.',
  benefit: 'Customers shouldn’t have to hunt for delivery details, opening hours or how to book. SayGday makes your approved answers easier to find, so visitors can work out whether your business is right for them—and take the next step when they’re ready.',
})

const PRICING_BODY = `<div class="wrap more" id="more">
    <div class="spare panel">
      <div>
        <p class="eyebrow">Why we’ve kept it affordable</p>
        <h2 class="title gs-title">A small cost.<br>A more helpful website.</h2>
      </div>
      <div class="spare__words">
        <p>${PRICING_STORY.reason}</p>
        <p>${PRICING_STORY.benefit}</p>
      </div>
    </div>
    <div class="page__part panel panel--mint">
      <p class="eyebrow">One plan. Everything you need to get started.</p>
      <h2 class="title gs-title">Your answers, ready when customers ask.</h2>
      <p class="intro">Start with your website. Check and approve the suggested answers. Add SayGday to your site and keep the answers up to date from your dashboard.</p>
      <div class="price-card">
        <div class="price-card__main">
          <div class="price__amount">A$30<small>a month</small></div>
          <p><strong>Have a week on us.</strong> Build and preview without a card. Verify your website and add a card for 7 free live days, then A$30/month automatically unless you cancel. Checkout shows your first billing date.</p>
          <a class="btn btn--light" href="/login" style="justify-self: start">Build my SayGday</a>
        </div>
        <ul class="price-card__list">${ticks([
          'Suggested questions and answers drafted from your website',
          'Your dashboard to choose, edit and approve the answers',
          'Your greeting, colours and choice of character or simple chat button',
          'Your approved answers on one supported website',
          'Submitted enquiries in your dashboard, with email notification when a visitor leaves an email address',
          'Product support while you manage your answers and installation',
        ])}</ul>
      </div>
    </div>
    <div class="page__part panel panel--cream" id="website-plan">
      <p class="eyebrow">A website service from oo.studio</p>
      <h2 class="title gs-title">Need a website to go with it?</h2>
      <p class="intro">Through oo.studio, I can build or refresh your website, set up an online shop where needed, and include SayGday in the same plan.</p>
      <p class="intro"><strong>A$60/month total, with SayGday included.</strong> Not A$60 plus a separate A$30 chatbot subscription for that website.</p>
      <ul class="price-card__list">${ticks([
        'A custom-designed, mobile-friendly website or refresh within an agreed scope',
        'Online shop setup where needed, with Square connections where supported',
        'Hosting, website care and agreed updates',
        'SayGday setup for the website, with answers you approve',
      ])}</ul>
      <p class="trial-note">We agree the pages, shop setup, connections and ongoing work before starting. Larger migrations, complex integrations and work outside that scope are quoted separately. Payment processing fees are separate; any extra third-party costs are agreed first.</p>
      <p class="trial-note"><a class="btn btn--green" href="https://oo.studio/#plan">Explore the oo.studio plan</a></p>
      <p class="trial-note">This is a separate website service, not another SayGday chatbot tier. Already paying for SayGday? Contact James before moving to the studio plan so the subscription and included access can be coordinated. Following this link does not change your billing.</p>
    </div>
    <div class="page__part panel">
      <p class="eyebrow">A few straight answers</p>
      <h2 class="title gs-title">Before you get started.</h2>
      <dl class="qa">
        <div><dt>When does my free week start?</dt><dd>Build and preview without a card. Verify your website and add a card through Stripe to activate 7 free live days. A$30/month starts automatically afterwards unless you cancel. Checkout shows your first billing date.</dd></div>
        <div><dt>Do I need a website?</dt><dd>Yes. SayGday uses your website to prepare suggested answers, and your website must allow the supplied chat code. Need a new website or refresh? ${STUDIO_LINK} includes SayGday for A$60/month total, within an agreed scope.</dd></div>
        <div><dt>Do I need to check the answers?</dt><dd>Yes. Check the facts, edit the wording and approve the answers you want visitors to read. You keep the final say and can update them in the dashboard.</dd></div>
        <div><dt>Does A$30 include a website or shop?</dt><dd>No. A$30/month is for SayGday on your existing website. oo.studio offers the separate A$60/month website-and-shop plan with SayGday included. The website work is agreed with James before starting.</dd></div>
        <div><dt>Will I pay A$30 as well as A$60?</dt><dd>No separate SayGday subscription is needed for the website covered by the oo.studio plan. The studio price is A$60/month total for the agreed service. Existing subscriptions are not switched or cancelled automatically; contact James to coordinate a move before paying for both.</dd></div>
        <div><dt>Does the free week include a website build?</dt><dd>No. Have a week on us applies to the SayGday software trial. Website work, its scope and any introductory arrangement are agreed separately through oo.studio.</dd></div>
        <div><dt>What about existing customers?</dt><dd>This is the current offer for new customers. Existing customers keep their agreed prices, subscriptions, access and saved trial dates unless a change is separately agreed.</dd></div>
        <div><dt>What happens when I cancel?</dt><dd>Cancel through Settings → Billing → Manage billing before your first charge to pay nothing. Cancelling during a paid period stops renewal. Removing the chat code alone does not cancel a subscription.</dd></div>
      </dl>
    </div>
  </div>
</main>`

function checked(html, from, to, label) {
  if (!html.includes(from)) throw new Error(`Single-plan copy ${label}: source wording changed`)
  return html.replaceAll(from, to)
}

export function publishSiteCopy(html, slug) {
  if (typeof html !== 'string' || typeof slug !== 'string') throw new TypeError('HTML and a page slug are required')
  let out = PREVIEW_SLUGS.includes(slug) ? applyApprovedCopy(html, slug) : html
  out = out
    .replaceAll('A$59 self-managed. A$99 with hands-on support.', 'One simple SayGday plan. A$30/month.')
    .replaceAll('7 days free. Card required. Then A$30/month.', 'One simple SayGday plan. A$30/month.')
    .replaceAll('7 days free. Card required to activate. Then A$30/month AUD automatically unless you cancel.', 'Have a week on us. Card required to activate 7 free days. Then A$30/month automatically unless you cancel.')
    .replaceAll('A$59', 'A$30')
    .replaceAll('Try 7 days free', 'Build my SayGday')
    .replaceAll('Start your free 7 days', 'Build my SayGday')

  if (slug === 'pricing') {
    out = checked(out, 'SayGday is A$30/month. Managed is A$99/month with setup and defined content support. Have a week on us with self-managed SayGday.', 'Spare change. On purpose. SayGday is A$30/month to help customers find your approved answers and feel more confident choosing your business. Have a week on us.', 'pricing description')
    out = checked(out, 'Your answers.<br><em>Your choice of support.</em>', PRICING_STORY.headline, 'pricing headline')
    out = checked(out, 'SayGday is A$30/month when you manage the answers yourself. Managed is A$99/month for a hand with setup and keeping them useful. Both put your business in control of the wording.', PRICING_STORY.introduction, 'pricing introduction')
    const body = /<div class="wrap more" id="more">[\s\S]*?<\/main>/
    if (!body.test(out)) throw new Error('Single-plan pricing content wrapper is missing')
    out = out.replace(body, PRICING_BODY)
    // Keep the existing short mobile journey, with the optional website link
    // visible before Learn more. It is not a second chatbot purchase button.
    const more = '<button class="phone-next__more"'
    out = checked(out, more, `<p class="trial-note">Need a website too? <a href="https://oo.studio/#plan">oo.studio is A$60/month total, with SayGday included.</a></p>${more}`, 'mobile studio link')
  }

  if (slug === 'getting-started') {
    out = out
      .replaceAll('Start with your website, approve your answers, then install and activate SayGday. Prefer help? Ask about Managed.', 'Scan your website, choose and approve your answers, then install and activate SayGday. One simple plan at A$30/month.')
      .replaceAll('Build and preview before you commit. Prepare the answers yourself, or choose Managed for a hand with setup and keeping them useful.', 'Build and preview before you commit. Start with your website, choose the questions, check the answers and try your SayGday before activating it.')
      .replaceAll('<strong>Prefer a hand?</strong> SayGday Managed is A$99/month, with setup help and a defined monthly content allowance. <a href="/pricing">See what’s included</a>.', `<strong>Need a website or a refresh?</strong> oo.studio is A$60/month total, with a scoped website, shop setup where needed and SayGday included. ${STUDIO_LINK}.`)
  }
  if (slug === 'contact') {
    out = out
      .replaceAll('Ask Jay about SayGday, Managed setup or whether your website is a good fit. Made in Canberra by oo.studio.', 'Ask James about SayGday, website compatibility or the oo.studio website plan. Made in Canberra by oo.studio.')
      .replaceAll('Have a question, need help choosing, or prefer someone to handle the setup? Tell me a little about your business and what you need.', 'Have a question about SayGday or your website? Tell me a little about your business and what you need.')
      .replaceAll('Managed setup<small>I’d like a hand</small>', 'Website help<small>A new site or refresh</small>')
  }
  if (slug === 'terms') {
    const clause = '<li><h3>Price and free days</h3><p>'
    out = checked(out, clause, `${clause}The A$30/month offer below applies to new customers from 16 October 2026. Existing customers retain their agreed prices, subscriptions, access and saved trial dates unless a change is separately agreed. Publishing this offer does not change their existing agreements.</p><p>`, 'terms scope')
    const end = 'We’ll give you at least 30 days’ notice by email before any price change.</p></li>'
    out = checked(out, end, 'We’ll give you at least 30 days’ notice by email before any price change.</p><p>The optional oo.studio website service is separate from this software subscription. Its A$60/month total includes SayGday for the covered website, with website work, shop setup, supported connections and ongoing care agreed before starting. Payment processing fees are separate and additional third-party costs or out-of-scope work are agreed first. The SayGday software trial does not include website-build work. Existing subscribers should contact James to coordinate any move; no subscription is automatically switched or cancelled.</p></li>', 'terms studio service')
      .replace('Last updated 9 October 2026.', 'New-customer offer updated 16 October 2026. Existing agreements remain unchanged.')
  }
  // The reviewed writing bank is historical. Apply the public-name rule after
  // every copy mapping so its old introduction cannot reintroduce the nickname.
  // This operates only on our static public pages, never on client-owned data.
  out = out.replace(/\bJay\b/g, 'James')
  // Prevent a half-published offer if the older writing bank changes.
  if (/A\$(?:59|75|99)\b|\bSayGday Managed\b|\bManaged setup\b|\bAsk about Managed\b/.test(out)) {
    throw new Error(`Retired offer remains on ${slug || 'home'}`)
  }
  return out
}
