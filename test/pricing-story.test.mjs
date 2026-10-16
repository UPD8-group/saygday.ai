import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PAGES, NOT_FOUND, composePage } from '../site/chrome.mjs'
import { PREVIEW_SLUGS, makeReviewOnly } from '../site/content-preview.mjs'
import { CURRENT_OFFERS, PRICING_STORY, publishSiteCopy } from '../site/published-copy.mjs'
import { sitePages } from '../site/vite-plugin.mjs'

const source = page => readFileSync(new URL(`../site/${page.file}`, import.meta.url), 'utf8')
const pageFor = slug => PAGES.find(page => page.slug === slug)
const published = page => publishSiteCopy(composePage(source(page), page.slug), page.slug)
const captures = (html, pattern) => [...html.matchAll(pattern)].map(match => match[0])

for (const page of [...PAGES, NOT_FOUND]) {
  test(`${page.slug || 'home'} publishes James, never the nickname, through the actual Vite path`, () => {
    const original = composePage(source(page), page.slug)
    const html = published(page)
    assert.doesNotMatch(html, /\bJay\b/i)
    const actual = sitePages().transformIndexHtml.handler(source(page), {
      filename: fileURLToPath(new URL(`../site/${page.file}`, import.meta.url)),
    })
    assert.equal(actual, html)
    for (const pattern of [/<img\b[^>]*>/g, /<link\b[^>]*rel="stylesheet"[^>]*>/g, /<script\b[^>]*>/g, /<form\b[^>]*>/g, /--photo-(?:wide|phone): url\('[^']+'\)/g]) {
      assert.deepEqual(captures(html, pattern), captures(original, pattern))
    }
    if (PREVIEW_SLUGS.includes(page.slug)) {
      const preview = makeReviewOnly(html, { slug: page.slug })
      assert.doesNotMatch(preview, /\bJay\b/i)
      assert.match(preview, /noindex, nofollow, noarchive/)
    }
  })
}

test('pricing restores the original headline and explains affordability before Learn more', () => {
  const html = published(pageFor('pricing'))
  assert.match(html, /<h1 class="title">Spare change\.<br><em>On purpose\.<\/em><\/h1>/)
  const hero = html.match(/<header class="photo-head[\s\S]*?<\/header>/)?.[0] || ''
  assert.ok(hero.includes(PRICING_STORY.introduction))
  assert.match(hero, /cost of living/)
  assert.match(hero, /feel more confident choosing your business/)
  assert.ok(PRICING_STORY.introduction.split(/\s+/).length <= 50)
  assert.ok(html.includes(PRICING_STORY.reason))
  assert.ok(html.includes(PRICING_STORY.benefit))
  assert.equal(captures(html, /class="spare panel"/g).length, 1)
  assert.equal(captures(html, /class="price-card"/g).length, 1)
  assert.equal(captures(html, /<h1\b/g).length, 1)
  assert.match(html, /\$30<small>a month<\/small>/)
  assert.match(html, /\$60\/month total, with SayGday included/)
  assert.match(html, /Have a week on us/)
  assert.match(html, /7 free live days/)
  assert.match(html, /Card required to activate/)
  assert.doesNotMatch(html, /\$(59|75|99)\b|SayGday Managed/)
  assert.equal(CURRENT_OFFERS.selfManagedMonthly, 3000)
  assert.equal(CURRENT_OFFERS.studioMonthly, 6000)
  assert.equal(CURRENT_OFFERS.trialDays, 7)
})

test('introduction, contact metadata and subscription-transition guidance all say James', () => {
  const contact = published(pageFor('contact'))
  assert.match(contact, /I’m James, the person behind oo\.studio/)
  assert.match(contact, /content="Ask James about SayGday/)
  assert.match(published(pageFor('pricing')), /Contact James before moving/)
  assert.match(published(pageFor('terms')), /contact James to coordinate/)
  const model = JSON.parse(readFileSync(new URL('../docs/content/saygday-offer-model-2026-10-16.json', import.meta.url), 'utf8'))
  assert.match(model.crossSell.existingSubscriberTransition, /Contact James/)
  assert.equal(model.plans.length, 1)
  assert.equal(model.plans[0].monthlyAmountMinor, 3000)
  assert.equal(model.crossSell.monthlyAmountMinor, 6000)
})
