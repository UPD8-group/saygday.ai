import assert from 'node:assert/strict'
import test from 'node:test'
import { access, readFile, readdir } from 'node:fs/promises'
import { JOURNEY, NOT_FOUND, PAGES, composePage, nextAfter, pathFor } from '../site/chrome.mjs'
import { CHARACTERS, PLAIN_BUTTONS, plainSvg } from '../shared/characters.mjs'
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
  assert.deepEqual(menu.map(page => page.name), ['Is this AI?', 'What’s different', 'How it works', 'Getting started', 'Meet the mob', 'Our story', 'Pricing', 'Contact'])
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
  // The contact page's company block: SayGday.ai, the address, then the ABN
  // (owner, 3 October 2026: drop "is a business name of HEAR.IS PTY LTD").
  const contactHtml = await built(named('contact'))
  const address = contactHtml.slice(contactHtml.indexOf('<address'), contactHtml.indexOf('</address>'))
  assert.deepEqual(address.replace(/<address[^>]*>/, '').split('<br>').map(line => line.trim()), ['SayGday.ai', 'Civic Quarter 1', '68 Northbourne Ave, Canberra ACT 2600'])
  assert.ok(words(contactHtml).includes('ABN 37 702 004 608'), 'contact page: the ABN')
  assert.doesNotMatch(contactHtml, /business name of|PTY LTD/, 'contact page: just SayGday.ai')
  // The email address stays only where the privacy page needs it (owner, 3
  // October 2026); everyone else uses the contact form.
  for (const page of ALL) {
    const html = await built(page)
    if (page.slug === 'privacy') assert.ok(html.includes('hello@saygday.ai'), 'the privacy page keeps the email address')
    else assert.doesNotMatch(html, /hello@saygday\.ai/, `${page.file}: no email address`)
  }
  for (const slug of ['privacy', 'terms']) assert.ok(words(await built(named(slug))).includes('HEAR.IS PTY LTD (ABN 37 702 004 608)'), `${slug}: names the company`)
  assert.ok((await readdir(new URL('public/site/', root))).every(file => !/jay/i.test(file)), 'no photo’s address says Jay')
  // Is this AI? Owner, 3 October 2026: "sort of but not the way you think".
  const isThisAi = await built(named('is-this-ai'))
  assert.match(isThisAi, /<p class="eyebrow">The honest answer<\/p>\s*<h1 class="title">Is this AI\?<br><em>Sort of\. But not the way you think\.<\/em><\/h1>/)
  for (const page of ALL) assert.doesNotMatch(words(await built(page)), /Yes, and no|A straight answer/i, `${page.file}: the old answer is gone, menu included`)
  assert.match(isThisAi, /<meta name="description" content="Sort of, but not the way you think\./)
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

test('Meet the mob shows the looks an owner can actually pick', async () => {
  const html = await built(named('meet-the-mob'))
  const mob = [...html.matchAll(/<img src="\/characters\/([a-z]+)\.webp"/g)].map(([, key]) => key)
  assert.deepEqual(mob, CHARACTERS.map(character => character.key), 'the mob, in the dashboard’s order')
  const plain = html.slice(html.indexOf('<div class="plain">'), html.indexOf('</div>', html.indexOf('<div class="plain">')))
  const shown = [...plain.matchAll(/<figure><span class="plain__btn">(.*?)<\/span><figcaption>([^<]+)<\/figcaption><\/figure>/g)].map(([, picture, name]) => ({ picture, name }))
  assert.deepEqual(shown.map(button => button.name), PLAIN_BUTTONS.map(button => button.name), 'the twelve plain buttons, named as the dashboard names them')
  for (const [index, button] of PLAIN_BUTTONS.entries()) {
    if (button.key === 'gday') assert.equal(shown[index].picture, '<span class="plain__word">G’day</span>')
    else assert.equal(shown[index].picture, plainSvg(button.key, 32), `${button.name} is drawn as the button draws it`)
  }
})

test('the contact page’s form is a Netlify form for joining or asking anything', async () => {
  const html = await built(named('contact'))
  const form = html.slice(html.indexOf('<form'), html.indexOf('</form>'))
  const tag = form.slice(0, form.indexOf('>') + 1)
  for (const attribute of ['name="contact"', 'method="POST"', 'action="/thanks"', 'data-netlify="true"', 'netlify-honeypot="bot-field"']) assert.ok(tag.includes(attribute), `the form tag has ${attribute}`)
  assert.match(form, /<input type="hidden" name="form-name" value="contact">/, 'the form names itself when sent from the page')
  assert.match(form, /<p class="contact-form__honey" aria-hidden="true"><label>[^<]*<input name="bot-field" tabindex="-1"/, 'a hidden field only bots fill')
  const topics = [...form.matchAll(/<input type="radio" name="topic" value="([^"]+)"/g)].map(([, value]) => value)
  assert.deepEqual(topics, ['Join SayGday', 'Question'], 'a business wanting to join, or anything else')
  assert.match(form, /name="topic" value="Join SayGday" required/, 'a topic must be chosen')
  for (const [name, required] of [['name', true], ['email', true], ['business', false], ['website', false], ['message', true]]) {
    const field = form.match(new RegExp(`<(?:input|textarea)[^>]* id="contact-${name}" name="${name}"[^>]*>`))
    assert.ok(field, `the ${name} field`)
    assert.equal(/ required/.test(field[0]), required, `${name} is ${required ? '' : 'not '}required`)
    assert.match(form, new RegExp(`<label for="contact-${name}">`), `the ${name} field has a label`)
  }
  assert.match(form, /id="contact-email" name="email" type="email"/)
  assert.match(form, /href="\/privacy"/, 'the form points to the privacy page')
  assert.match(html, /<div class="contact-thanks" id="contact-thanks" hidden>/, 'the in-place thanks waits hidden')
  assert.match(await read('src/site/site.css'), /\.contact-form\[hidden\], \.contact-thanks\[hidden\] \{ display: none; \}/, 'and hidden really hides it, despite display: grid')
  const thanks = await built(named('thanks'))
  assert.match(thanks, /<meta name="robots" content="noindex">/)
  assert.match(words(thanks), /We’ve got your message/)
  const script = await read('src/site/site.js')
  assert.match(script, /document\.querySelector\('form\[name="contact"\]'\)/)
  assert.match(script, /fetch\(contact\.getAttribute\('action'\), \{\s*method: 'POST',\s*headers: \{ 'Content-Type': 'application\/x-www-form-urlencoded' \},\s*body: new URLSearchParams\(new FormData\(contact\)\)\.toString\(\),/, 'sends what the plain form would, to the same place')
  assert.match(script, /if \(!response\.ok\) throw/, 'a failed send says so instead of thanking')
  const privacy = words(await built(named('privacy')))
  assert.ok(privacy.includes('When you use the form on our contact page, we keep your name, email address, your message and any business details you add'), 'the privacy page covers the form')
  assert.ok(privacy.includes('holds the messages sent through our contact form'), 'and names who holds them')
})

// The rules inside each @media block of the stylesheet, by its query.
function mediaRules(css, query) {
  const blocks = []
  for (let at = css.indexOf(`@media ${query} {`); at !== -1; at = css.indexOf(`@media ${query} {`, at + 1)) {
    let depth = 0, end = css.indexOf('{', at)
    for (let i = end; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) { end = i; break }
    }
    blocks.push(css.slice(css.indexOf('{', at) + 1, end))
  }
  return blocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
}

test('on a phone the site has room (owner, 3 October 2026: “the mobile version looks a little bit cramped”)', async () => {
  const css = await read('src/site/site.css')
  const gutter = css.match(/--gutter: clamp\((\d+)px, [\d.]+vw, (\d+)px\);/)
  assert.ok(gutter, 'the page gutter is one clamp')
  assert.ok(Number(gutter[1]) >= 20, 'at least 20px at the side of a phone')
  assert.equal(gutter[2], '40', 'and desktop keeps its 40px')
  // When it matters: once the grid drops its area names, anything still placed
  // by name lands in a stray column (the photo shrank to nothing).
  const tablet = mediaRules(css, '(max-width: 900px)')
  assert.match(tablet, /\.moment--photo \{[^}]*grid-template-areas: none;/)
  for (const named of ['.moment--photo .moment__text', '.moment__photo', '.moment__visual .proof']) {
    const rule = [...tablet.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, selectors, body]) => selectors.split(',').map(s => s.trim()).includes(named) && /grid-area: auto;/.test(body))
    assert.ok(rule, `${named} stops being placed by name on a phone`)
  }
  // What's different: one card per row, each answer labelled.
  const phone = mediaRules(css, '(max-width: 640px)')
  assert.match(phone, /\.versus__row \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the comparison stacks')
  assert.match(phone, /\.versus__them::before \{ content: "Most chatbots" \/ ""; /, 'most chatbots’ answer says whose it is')
  assert.match(phone, /\.versus__us::before \{ content: "SayGday" \/ ""; /, 'and so does ours')
  assert.match(phone, /\.versus__head \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset\(50%\);/, 'the heading row stays for screen readers')
  const small = mediaRules(css, '(max-width: 480px)')
  assert.match(small, /\.draft \{ grid-template-columns: minmax\(0, 1fr\);/, 'Getting started: the check goes under the answer')
  assert.match(small, /\.plain \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, 'Meet the mob: three plain buttons to a row')
})

test('on a phone the front page’s photo sits at the top, like every other page (owner, 3 October 2026)', async () => {
  const phone = mediaRules(await read('src/site/site.css'), '(max-width: 600px)')
  assert.match(phone, /\.hero \{ --hero-top: 44px; --hero-photo: min\(128vw, 560px\); \}/, 'the photo’s band under the bar')
  assert.match(phone, /\.hero__photo \{[^}]*#1b2620 45% var\(--hero-top\) \/ auto var\(--hero-photo\) no-repeat var\(--photo\);/, 'drawn from just under the bar, his face and the cup in view')
  assert.match(phone, /\.hero__spacer \{ height: calc\(var\(--hero-top\) \+ var\(--hero-photo\) - 84px\); \}/, 'and the words start below it, not over his face')
  assert.match(await read('src/site/site.css'), /@media \(min-width: 901px\) \{ \.hero__photo \{ background-size: 118% auto; background-position: 0% 30%; \} \}/, 'wide screens keep the photo behind the words')
})

test('on a phone each page is its short version first: a big button on, and Learn more for the rest (owner, 3 October 2026)', async () => {
  assert.deepEqual(JOURNEY, ['', 'is-this-ai', 'whats-different', 'how-it-works', 'getting-started', 'meet-the-mob', 'story', 'pricing'], 'the front page, then Is this AI?, then the menu in order')
  for (const slug of JOURNEY) {
    const html = await built(named(slug))
    const block = html.match(/<div class="phone-next">([\s\S]*?)<\/div>/)
    assert.ok(block, `${slug || 'home'}: the phone block`)
    const next = nextAfter(slug)
    const go = block[1].match(/<a class="btn btn--big [^"]+" href="([^"]+)">([^<]+?) <svg/)
    assert.ok(go, `${slug || 'home'}: one big button`)
    assert.equal(go[1], next ? pathFor(next) : '/login', `${slug || 'home'}: on to the next page`)
    assert.equal(go[2], slug === '' ? 'Next: The honest answer' : next ? `Next: ${next.name}` : 'Start your free 14 days')
    if (next && slug !== '') assert.ok(html.includes(`<a class="next__on" href="${pathFor(next)}">Next: ${next.name} →</a>`), `${slug}: the desktop’s Next link agrees`)
    if (slug === '') {
      assert.doesNotMatch(block[1], /data-more/, 'the front page is all short version')
      assert.ok(html.indexOf('<div class="phone-next">') > html.indexOf('</figure>'), 'its button comes after the example chat')
      assert.match(html, /<a class="btn btn--line hide-phone" href="\/whats-different">/, 'the big button replaces the small link on a phone')
      continue
    }
    assert.match(block[1], /<button class="phone-next__more" type="button" aria-expanded="false" aria-controls="more" data-more><span>Learn more<\/span>/, `${slug}: Learn more`)
    const rest = html.slice(html.indexOf('id="more"'))
    assert.ok(html.indexOf('<div class="phone-next">') < html.indexOf('id="more"'), `${slug}: the button comes before the rest`)
    assert.ok(words(rest).length > 400, `${slug}: the rest of the page is behind Learn more`)
    if (html.includes('<header class="photo-head')) {
      assert.ok(html.indexOf('</header>') < html.indexOf('<div class="phone-next">'), `${slug}: the photo and its few lines stay`)
      assert.match(html, /<div class="wrap more" id="more">/)
    }
  }
  for (const slug of ['contact', 'privacy', 'terms', 'login', 'thanks', '404']) {
    const html = await built(named(slug))
    assert.doesNotMatch(mainOf(html), /phone-next|class="[^"]*\bmore\b/, `${slug}: read whole`)
  }
  assert.throws(() => composePage('<!-- site:head --><!-- site:bar --><!-- site:foot -->', 'pricing'), /expected 1 <!-- site:phone-next -->/, 'a page on the way can’t lose its button')
  const css = await read('src/site/site.css')
  assert.match(css, /\n\.phone-next \{ display: none; \}/, 'desktop never sees it')
  const phone = mediaRules(css, '(max-width: 600px)')
  assert.match(phone, /\.phone-next \{ display: grid;/)
  assert.match(phone, /\.more:not\(\.is-open\) \{ display: none; \}/, 'the rest waits for Learn more')
  assert.match(phone, /\.hide-phone \{ display: none; \}/)
  assert.match(await built(named('')), /<noscript><style>\.more \{ display: block !important; \}/, 'without JavaScript, a phone gets the whole page')
  const script = await read('src/site/site.js')
  assert.match(script, /label\.textContent = open \? 'Show less' : 'Learn more'/)
  assert.match(script, /for \(const body of bodies\) body\.classList\.toggle\('is-open', open\)/)
})
