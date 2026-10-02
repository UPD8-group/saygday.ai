import assert from 'node:assert/strict'
import test from 'node:test'
import { access, readFile, readdir } from 'node:fs/promises'
import { NOT_FOUND, PAGES, composePage, pathFor } from '../site/chrome.mjs'
import { outputFor, siteInputs } from '../site/vite-plugin.mjs'

// The public website: the design the owner approved on 2 October 2026, built
// from site/*.html with one copy of the bar, menu and footer.
const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const exists = path => access(new URL(path, root)).then(() => true, () => false)
const ALL = [...PAGES, NOT_FOUND]
const built = async page => composePage(await read(`site/${page.file}`), page.slug)
const mainOf = html => html.slice(html.indexOf('<main'), html.indexOf('</main>'))
const words = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const named = slug => ALL.find(page => page.slug === slug)

test('every page is built at an address of its own, with a title, a description and one heading', async () => {
  const files = (await readdir(new URL('site/', root))).filter(file => file.endsWith('.html'))
  assert.deepEqual(files.sort(), ALL.map(page => page.file).sort(), 'every page in site/ is listed, and every listed page exists')
  assert.equal(outputFor(named('')), 'index.html')
  assert.equal(outputFor(named('pricing')), 'pricing.html', 'served at /pricing, with no redirect to /pricing/')
  assert.equal(outputFor(NOT_FOUND), '404.html', 'Netlify shows 404.html for an address that doesn’t exist')
  const inputs = Object.values(siteInputs)
  for (const page of ALL) {
    assert.ok(inputs.some(input => input.endsWith(`/site/${page.file}`)), `${page.file} is built`)
    const html = await built(page)
    assert.match(html, /<html lang="en-AU">/)
    assert.match(html, /<title>[^<]*SayGday[^<]*<\/title>/, `${page.file} has a title`)
    if (page !== NOT_FOUND) assert.match(html, /<meta name="description" content="[^"]{40,}">/, `${page.file} has a description`)
    assert.equal(html.match(/<h1[\s>]/g)?.length, 1, `${page.file} has exactly one main heading`)
    assert.match(html, /<main id="main"/, 'the skip link has somewhere to go')
  }
})

test('a page missing one of its shared parts doesn’t build', () => {
  assert.throws(() => composePage('<!-- site:head --><!-- site:bar -->', 'pricing'), /site:foot/)
  assert.throws(() => composePage('<!-- site:head --><!-- site:bar --><!-- site:bar --><!-- site:foot -->', 'pricing'), /site:bar/)
})

test('the bar, the menu and the footer are on every page, and the menu marks the page you’re on', async () => {
  const menu = PAGES.filter(page => page.name)
  assert.deepEqual(menu.map(page => page.name), ['What’s different', 'How it works', 'Getting started', 'Is this AI?', 'Meet the mob', 'Our story', 'Pricing', 'Contact'])
  for (const page of ALL) {
    const html = await built(page)
    assert.match(html, /<a class="bar__cta" href="\/login">Try it free<\/a>/, `${page.file}: the bar`)
    for (const item of menu) assert.ok(html.includes(`href="${pathFor(item)}"`), `${page.file}: menu links to ${item.name}`)
    const current = html.match(/<a class="menu__link" href="([^"]+)" aria-current="page">/g) || []
    assert.equal(current.length, page.name ? 1 : 0, `${page.file}: the menu marks only this page`)
    if (page.name) assert.ok(current[0].includes(`href="${pathFor(page)}"`))
    assert.ok(html.includes('Copyright © 2026 SayGday.ai - All rights reserved.'), `${page.file}: the footer`)
    assert.ok(html.includes('SayGday.ai acknowledges the Traditional Owners of the lands on which we work. We pay our respects to Elders past and present.'), `${page.file}: the Acknowledgement of Country`)
    assert.match(html, /<link rel="stylesheet" href="\/src\/site\/site\.css">/)
  }
})

test('every link and photo on the site goes somewhere real', async () => {
  const addresses = new Set(PAGES.map(pathFor))
  for (const page of ALL) {
    const html = await built(page)
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      if (href === '#main' || href.startsWith('/favicon') || href.startsWith('/src/') || href.startsWith('https://fonts.')) continue
      if (href.startsWith('https://')) { assert.match(href, /^https:\/\/unsplash\.com\//, `${page.file}: ${href} is a photo credit`); continue }
      assert.ok(addresses.has(href), `${page.file}: ${href} is one of the site’s pages`)
    }
    for (const [, src] of html.matchAll(/(?:src="|url\(')(\/(?:site|characters)\/[^"')]+)/g)) {
      assert.ok(await exists(`public${src}`), `${page.file}: ${src} exists`)
    }
  }
  const css = await read('src/site/site.css')
  for (const [, src] of css.matchAll(/url\("?(\/site\/[^")]+)/g)) assert.ok(await exists(`public${src}`), `site.css: ${src} exists`)
})

test('every Unsplash photo is credited to its photographer', async () => {
  const credits = { '': 'Snappr', 'whats-different': 'rakhmat suwandi', 'getting-started': 'Vitaly Gariev', 'meet-the-mob': 'Tianlei Sun', pricing: 'Miles Burke', privacy: 'Santy Sun', terms: 'Santy Sun', login: 'Ellena McGuinness' }
  for (const [slug, photographer] of Object.entries(credits)) {
    const html = await built(named(slug))
    assert.match(html, new RegExp(`Photo: <a href="https://unsplash\\.com/@[^"]+">${photographer}</a>, <a href="https://unsplash\\.com/photos/[^"]+">Unsplash</a>`), `${slug || 'home'}: credited to ${photographer}`)
  }
})

test('the owner’s rules for the public copy', async () => {
  const home = mainOf(await built(named('')))
  assert.doesNotMatch(words(home), /\bAI\b/, 'the front page never mentions AI (owner, 2 October 2026)')
  for (const page of ALL) {
    const html = await built(page)
    assert.doesNotMatch(words(html), /\bJay\b/, `${page.file}: public copy names James`)
    assert.doesNotMatch(html, /every email/i, `${page.file}: no “James reads every email” (owner, 2 October 2026)`)
    assert.doesNotMatch(html, /design preview|data-view|href="#(?!main")/, `${page.file}: nothing left over from the mockup`)
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'))
    assert.doesNotMatch(footer, /ABN|PTY LTD/, `${page.file}: the company details live on the contact page, not the footer`)
  }
  const contact = words(await built(named('contact')))
  for (const line of ['SayGday.ai is a business name of HEAR.IS PTY LTD', 'Civic Quarter 1', '68 Northbourne Ave, Canberra ACT 2600', 'ABN 37 702 004 608', 'hello@saygday.ai']) {
    assert.ok(contact.includes(line), `contact page: ${line}`)
  }
  for (const slug of ['privacy', 'terms']) assert.ok(words(await built(named(slug))).includes('HEAR.IS PTY LTD (ABN 37 702 004 608)'), `${slug}: names the company`)
  assert.ok((await readdir(new URL('public/site/', root))).every(file => !/jay/i.test(file)), 'no photo’s address says Jay')
})

test('sign-in is a page of the website, and the dashboard sends signed-out owners to it', async () => {
  const login = await built(named('login'))
  assert.match(login, /<div class="login__card" id="sign-in">/)
  assert.match(login, /<script type="module" src="\/src\/site\/sign-in\.jsx"><\/script>/)
  const toml = await read('netlify.toml')
  assert.doesNotMatch(toml, /from = "\/"\n/, 'the front page is the website, not a redirect to the dashboard')
  assert.doesNotMatch(toml, /from = "\/login"/, 'sign-in is a real page')
  assert.match(toml, /from = "\/app\/\*"\n\s+to = "\/app\.html"\n\s+status = 200/)
  assert.match(toml, /from = "\/app"\n\s+to = "\/app\.html"\n\s+status = 200/)
  const app = await read('src/App.jsx')
  assert.doesNotMatch(app, /\/login|Login/, 'the dashboard has no sign-in screen of its own')
  const dashboard = await read('src/app/Dashboard.jsx')
  assert.match(dashboard, /export const goToSignIn = \(\) => window\.location\.replace\('\/login'\)/)
  assert.match(dashboard, /if \(!session\) return <GoToSignIn \/>/)
  assert.doesNotMatch(dashboard + await read('src/app/Settings.jsx'), /navigate\('\/login'\)|to="\/login"/, 'a page change inside the dashboard can’t reach the website’s sign-in page')
  assert.match(await read('app.html'), /<meta name="robots" content="noindex" \/>/, 'search engines list the website, not the dashboard')
})
