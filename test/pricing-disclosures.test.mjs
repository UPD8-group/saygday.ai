import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PAGES, composePage } from '../site/chrome.mjs'
import { publishSiteCopy } from '../site/published-copy.mjs'
import { makeReviewOnly } from '../site/content-preview.mjs'

const page = PAGES.find(page => page.slug === 'pricing')
const source = readFileSync(new URL(`../site/${page.file}`, import.meta.url), 'utf8')
const live = publishSiteCopy(composePage(source, page.slug), page.slug)
const preview = makeReviewOnly(live, { slug: page.slug })

for (const [name, html] of [['live', live], ['preview', preview]]) {
  test(`${name} pricing keeps card collection and renewal beside both signup actions`, () => {
    const menu = html.match(/<nav class="menu"[\s\S]*?<\/nav>/)?.[0]
    const mobile = html.match(/<div class="phone-next">[\s\S]*?<\/div>/)?.[0]
    assert.ok(menu, 'shared menu exists')
    assert.ok(mobile, 'mobile action exists')
    for (const region of [menu, mobile]) {
      const note = region.match(/<p class="trial-note">([^<]*)<\/p>/)?.[1]
      assert.ok(note, 'a text disclosure is present beside the signup action')
      assert.match(note, /Have a week on us/)
      assert.match(note, /Card required to activate 7 free days/)
      assert.match(note, /Then A\$30\/month automatically unless you cancel/)
      assert.match(note, /Checkout shows your first billing date/)
      assert.doesNotMatch(note, /Spare change|Managed|feel more confident/)
    }
    assert.match(html, /<meta name="description" content="Spare change\. On purpose\./)
    assert.match(html, /<h1 class="title">Spare change\.<br><em>On purpose\.<\/em><\/h1>/)
    assert.ok(mobile.indexOf('Card required') < mobile.indexOf('data-more'), 'disclosure is outside collapsed details')
  })
}
