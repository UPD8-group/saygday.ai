import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PAGES, composePage } from '../site/chrome.mjs'
import { PREVIEW_SLUGS, makeReviewOnly, reviewScripts } from '../site/content-preview.mjs'
import { publishSiteCopy, CURRENT_OFFERS } from '../site/published-copy.mjs'
import { sitePages } from '../site/vite-plugin.mjs'

const source = page => readFileSync(new URL(`../site/${page.file}`, import.meta.url), 'utf8')
const captures = (html, pattern) => [...html.matchAll(pattern)].map(match => match[0])
for (const page of PAGES) {
  test(`published ${page.slug || 'home'} keeps the design and uses the approved offer`, () => {
    const original = composePage(source(page), page.slug)
    const html = publishSiteCopy(original, page.slug)
    assert.doesNotMatch(html, /A\$99|A\$30|proposed offers|changed by this proposal/)
    assert.deepEqual(captures(html, /<img\b[^>]*>/g), captures(original, /<img\b[^>]*>/g))
    assert.deepEqual(captures(html, /--photo-(?:wide|phone): url\('[^']+'\)/g), captures(original, /--photo-(?:wide|phone): url\('[^']+'\)/g))
    assert.deepEqual(captures(html, /<link\b[^>]*rel="stylesheet"[^>]*>/g), captures(original, /<link\b[^>]*rel="stylesheet"[^>]*>/g))
    assert.deepEqual(captures(html, /<form\b[^>]*>/g), captures(original, /<form\b[^>]*>/g), 'live forms are not disabled or replaced')
    assert.deepEqual(captures(html, /<script\b[^>]*>/g), captures(original, /<script\b[^>]*>/g), 'login, theme, menu and production chat remain attached')
    assert.doesNotMatch(html, /Content preview only|Copy preview/)
    const built = sitePages().transformIndexHtml.handler(source(page), { filename: fileURLToPath(new URL(`../site/${page.file}`, import.meta.url)) })
    assert.equal(built, html, 'the live Vite path actually publishes the copy, not just a review route')
  })
}

test('Managed is A$75 monthly with a qualified A$2.50 daily comparison', () => {
  const page = PAGES.find(page => page.slug === 'pricing')
  const html = publishSiteCopy(composePage(source(page), page.slug), page.slug)
  assert.match(html, /A\$59<small>a month<\/small>/)
  assert.match(html, /A\$75<small>a month<\/small>/)
  assert.match(html, /About A\$2\.50 a day, billed A\$75 monthly/)
  assert.match(html, /30-day month/)
  assert.match(html, /up to 20 short questions and answers/)
  assert.match(html, /Up to 20 minutes/)
  assert.match(html, /Ask about Managed/)
  assert.match(html, /Existing customers keep their agreed prices/)
  assert.equal(CURRENT_OFFERS.managedMonthly / CURRENT_OFFERS.dailyComparisonDays, 250)
})

test('only review routes disable forms and omit the live widget', () => {
  const home = PAGES.find(page => page.slug === '')
  const scripts = reviewScripts(publishSiteCopy(composePage(source(home), ''), ''))
  for (const slug of PREVIEW_SLUGS) {
    const page = PAGES.find(page => page.slug === slug)
    const live = publishSiteCopy(composePage(source(page), slug), slug)
    const preview = makeReviewOnly(live, { slug, scripts })
    assert.match(preview, /noindex, nofollow, noarchive/)
    assert.doesNotMatch(preview, /A\$99|A\$30|<form\b|widget\.js/)
    assert.match(preview, /Content preview only/)
  }
})

test('terms identify new customers and preserve existing agreements', () => {
  const page = PAGES.find(page => page.slug === 'terms')
  const html = publishSiteCopy(composePage(source(page), page.slug), page.slug)
  assert.match(html, /apply to new customers from 16 October 2026/)
  assert.match(html, /does not change their existing agreements/)
  assert.match(html, /at least 30 days’ notice by email/)
  assert.match(html, /SayGday Managed is A\$75\/month AUD/)
})
