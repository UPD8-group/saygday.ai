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
  test(`published ${page.slug || 'home'} keeps the UX and publishes only the current offer`, () => {
    const original = composePage(source(page), page.slug)
    const html = publishSiteCopy(original, page.slug)
    assert.doesNotMatch(html, /\$(?:59|75|99)\b|SayGday Managed|Ask about Managed|Managed setup|proposed offers/)
    assert.deepEqual(captures(html, /<img\b[^>]*>/g), captures(original, /<img\b[^>]*>/g))
    assert.deepEqual(captures(html, /--photo-(?:wide|phone): url\('[^']+'\)/g), captures(original, /--photo-(?:wide|phone): url\('[^']+'\)/g))
    assert.deepEqual(captures(html, /<link\b[^>]*rel="stylesheet"[^>]*>/g), captures(original, /<link\b[^>]*rel="stylesheet"[^>]*>/g))
    assert.deepEqual(captures(html, /<form\b[^>]*>/g), captures(original, /<form\b[^>]*>/g))
    assert.deepEqual(captures(html, /<script\b[^>]*>/g), captures(original, /<script\b[^>]*>/g))
    assert.doesNotMatch(html, /Content preview only|Copy preview/)
    assert.match(html, /\$30/)
    assert.doesNotMatch(html, /A\$|\bAUD\b/, 'visible prices use a plain dollar sign')
    assert.equal(captures(html, /<h1\b/g).length, 1)
    const built = sitePages().transformIndexHtml.handler(source(page), { filename: fileURLToPath(new URL(`../site/${page.file}`, import.meta.url)) })
    assert.equal(built, html)
  })
}

test('one $30 software price card and a separate scoped $60 studio cross-link', () => {
  const page = PAGES.find(page => page.slug === 'pricing')
  const html = publishSiteCopy(composePage(source(page), page.slug), page.slug)
  assert.equal(captures(html, /class="price-card"/g).length, 1)
  assert.match(html, /\$30<small>a month<\/small>/)
  assert.match(html, /\$60\/month total, with SayGday included/)
  assert.match(html, /Not \$60 plus a separate \$30/)
  assert.match(html, /href="https:\/\/oo\.studio\/#plan"/)
  assert.match(html, /Payment processing fees are separate/)
  assert.match(html, /quoted separately/)
  assert.match(html, /does not change your billing/)
  assert.match(html, /Have a week on us/)
  assert.match(html, /7 free live days/)
  assert.doesNotMatch(html, /20 minutes|20 short|roll over/)
  const mobile = html.match(/<div class="phone-next">[\s\S]*?<\/div>/)?.[0] || ''
  assert.match(mobile, /href="\/login"/)
  assert.match(mobile, /href="https:\/\/oo\.studio\/#plan"/)
  assert.ok(mobile.indexOf('oo.studio/#plan') < mobile.indexOf('data-more'))
  assert.equal(CURRENT_OFFERS.selfManagedMonthly, 3000)
  assert.equal(CURRENT_OFFERS.studioMonthly, 6000)
  assert.equal(CURRENT_OFFERS.studioIncludesSayGday, true)
})

test('only review routes disable forms and omit live chat', () => {
  const home = PAGES.find(page => page.slug === '')
  const scripts = reviewScripts(publishSiteCopy(composePage(source(home), ''), ''))
  for (const slug of PREVIEW_SLUGS) {
    const page = PAGES.find(page => page.slug === slug)
    const live = publishSiteCopy(composePage(source(page), slug), slug)
    const preview = makeReviewOnly(live, { slug, scripts })
    assert.match(preview, /noindex, nofollow, noarchive/)
    assert.doesNotMatch(preview, /\$(?:59|75|99)\b|<form\b|widget\.js/)
    assert.match(preview, /Content preview only/)
  }
})

test('terms preserve prior agreements and keep website work separate from the software trial', () => {
  const page = PAGES.find(page => page.slug === 'terms')
  const html = publishSiteCopy(composePage(source(page), page.slug), page.slug)
  assert.match(html, /applies to new customers from 16 October 2026/)
  assert.match(html, /does not change their existing agreements/)
  assert.match(html, /at least 30 days’ notice by email/)
  assert.match(html, /\$60\/month total includes SayGday/)
  assert.match(html, /does not include website-build work/)
})
