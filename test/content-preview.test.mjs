import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAGES, composePage } from '../site/chrome.mjs'
import { PREVIEW_SLUGS, applyApprovedCopy, makeReviewOnly, previewPath, previewOutput, reviewScripts } from '../site/content-preview.mjs'

const sourceFor = slug => readFileSync(new URL(`../site/${PAGES.find(page => page.slug === slug).file}`, import.meta.url), 'utf8')
const composed = slug => composePage(sourceFor(slug), slug)
const captures = (html, pattern) => [...html.matchAll(pattern)].map(match => match[0])

for (const slug of PREVIEW_SLUGS) {
  test(`approved copy fits the existing ${slug || 'home'} page and preserves design assets`, () => {
    const original = composed(slug)
    const revised = applyApprovedCopy(original, slug)
    assert.notEqual(revised, original)
    assert.doesNotMatch(revised, /\$30|Spare change|interactive FAQ|About \$1 a day/i)
    assert.match(revised, /\$59/)
    assert.equal(captures(revised, /<h1\b/g).length, 1)
    assert.deepEqual(captures(revised, /<img\b[^>]*>/g), captures(original, /<img\b[^>]*>/g))
    assert.deepEqual(captures(revised, /--photo-(?:wide|phone): url\('[^']+'\)/g), captures(original, /--photo-(?:wide|phone): url\('[^']+'\)/g))
    assert.deepEqual(captures(revised, /<link\b[^>]*rel="stylesheet"[^>]*>/g), captures(original, /<link\b[^>]*rel="stylesheet"[^>]*>/g))
    for (const style of captures(original, /style="[^"]*"/g)) assert.ok(revised.includes(style), style)
    assert.match(revised, /id="burger"/)
    assert.match(revised, /id="theme"/)
    if (original.includes('data-more')) assert.match(revised, /data-more/)
    assert.match(revised, /Traditional Owners/)
  })
  test(`${slug || 'home'} preview cannot submit forms or load the production widget`, () => {
    const html = makeReviewOnly(applyApprovedCopy(composed(slug), slug), { slug, scripts: reviewScripts(composed('')) })
    assert.match(html, /noindex, nofollow, noarchive/)
    assert.doesNotMatch(html, /<form\b|data-netlify=|widget\.js|src="\/src\/site\/sign-in\.jsx"/)
    assert.match(html, /src="\/src\/site\/site\.js"/)
    assert.match(html, /Content preview only/)
    assert.match(html, new RegExp(`href="${previewPath('pricing')}"`))
    assert.doesNotMatch(html, /href="\/login"/)
    for (const input of captures(html, /<(?:input|textarea|select)\b[^>]*>/g)) assert.match(input, /\sdisabled(?:\s|>)/)
    assert.equal(previewOutput(slug), `content-preview/${slug ? `${slug}/` : ''}index.html`)
  })
}

test('pricing uses existing price-card components for both clearly scoped offers', () => {
  const html = applyApprovedCopy(composed('pricing'), 'pricing')
  assert.equal(captures(html, /class="price-card"/g).length, 2)
  assert.match(html, /\$59<small>a month<\/small>/)
  assert.match(html, /\$99<small>a month<\/small>/)
  assert.match(html, /up to 20 short questions and answers/)
  assert.match(html, /Up to 20 minutes of content work each month/)
  assert.match(html, /does not roll over/)
  assert.match(html, /href="\/contact"[^>]*>Ask about Managed/)
  assert.match(html, /Existing agreed prices, subscriptions and saved trial dates/)
})

test('homepage retains its approved headline and keeps AI explanation on its own page', () => {
  const html = applyApprovedCopy(composed(''), '')
  const hero = html.match(/<header class="hero"[\s\S]*?<\/header>/)?.[0] || ''
  assert.match(hero, /Looks like a chatbot\.<br><em>Answers like you\.<\/em>/)
  assert.match(hero, /Your answers\. Your final say\./)
  assert.match(hero, /Have a week on us/)
  assert.doesNotMatch(hero, /\bAI\b/)
})

test('stale or unsupported source copy fails loudly', () => {
  assert.throws(() => applyApprovedCopy('<html></html>', ''), /source copy changed/)
  assert.throws(() => applyApprovedCopy('', 'missing'), TypeError)
  assert.throws(() => makeReviewOnly('', { slug: 'missing' }), TypeError)
})

test('review scripts preserve the homepage UX, not its live chat', () => {
  const scripts = reviewScripts(composed(''))
  assert.match(scripts, /theme\.js/)
  assert.match(scripts, /src\/site\/site\.js/)
  assert.doesNotMatch(scripts, /widget\.js/)
})
