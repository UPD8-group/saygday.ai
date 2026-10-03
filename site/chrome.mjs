// The public website's shared parts: the head, the bar and its menu, and the
// footer. Every page in site/ marks where they go (<!-- site:head -->,
// <!-- site:bar -->, <!-- site:foot -->) and site/vite-plugin.mjs fills them
// in at build time, so each part exists once. The design is the one the owner
// approved on 2 October 2026 (a mockup published as a private artifact).

// Every public page, in menu order. `file` is the page in site/; `slug` is its
// address (/whats-different). Pages without a menu entry are still published.
export const PAGES = Object.freeze([
  { slug: '', file: 'index.html' },
  { slug: 'whats-different', file: 'whats-different.html', name: 'What’s different', hint: 'It looks like a chatbot. Here’s how it isn’t one.' },
  { slug: 'how-it-works', file: 'how-it-works.html', name: 'How it works', hint: 'Where SayGday sits between you and your customers.' },
  { slug: 'getting-started', file: 'getting-started.html', name: 'Getting started', hint: 'Set up your business in an afternoon.' },
  { slug: 'is-this-ai', file: 'is-this-ai.html', name: 'Is this AI?', hint: 'Sort of. But not the way you think.' },
  { slug: 'meet-the-mob', file: 'meet-the-mob.html', name: 'Meet the mob', hint: 'Pick a local for the corner of your website.' },
  { slug: 'story', file: 'story.html', name: 'Our story', hint: 'Made in Canberra by James, Luna and Stormi.' },
  { slug: 'pricing', file: 'pricing.html', name: 'Pricing', hint: 'A$30 a month. First 14 days free.' },
  { slug: 'contact', file: 'contact.html', name: 'Contact', hint: 'Where to find us, and how to get in touch.' },
  { slug: 'thanks', file: 'thanks.html' },
  { slug: 'privacy', file: 'privacy.html' },
  { slug: 'terms', file: 'terms.html' },
  { slug: 'login', file: 'login.html' },
].map(Object.freeze))

// Not a page anyone navigates to: Netlify shows it for an address that
// doesn't exist.
export const NOT_FOUND = Object.freeze({ slug: '404', file: '404.html' })

export const pathFor = page => (page.slug ? `/${page.slug}` : '/')

const ARROW = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 9h11m-4-4.5L14.5 9 10 13.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function head() {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#213f34">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&amp;family=Caveat:wght@600&amp;display=swap">
<link rel="stylesheet" href="/src/site/site.css">
<script type="module" src="/src/site/site.js"></script>`
}

// The bar on every page, and the menu its burger opens. The page being shown
// is marked in the menu.
export function bar(slug) {
  const links = PAGES.filter(page => page.name).map(page => {
    const current = page.slug === slug ? ' aria-current="page"' : ''
    return `      <li><a class="menu__link" href="${pathFor(page)}"${current}><span class="menu__name">${page.name}</span><span class="menu__hint">${page.hint}</span></a></li>`
  }).join('\n')
  return `<a class="skip" href="#main">Skip to the page</a>
<div class="bar">
  <div class="wrap bar__inner">
    <a class="logo" href="/"><span class="logo__mark" aria-hidden="true"></span><span class="logo__word">SayGday<span>.ai</span></span></a>
    <a class="bar__cta" href="/login">Try it free</a>
    <button class="burger" id="burger" type="button" aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span class="burger__lines"></span></button>
  </div>
</div>
<nav class="menu" id="menu" aria-label="Main" hidden>
  <div class="wrap">
    <ul>
${links}
    </ul>
    <div class="menu__foot"><a class="btn btn--light" href="/login">Try it free ${ARROW}</a><a class="menu__login" href="/login">Log in</a></div>
  </div>
</nav>`
}

// SayGday's own chat button (owner, 3 October 2026), on every page: the same
// line every business pastes, so saygday.ai's home page passes the same
// ownership check a business's does. Its answers are in the owner's dashboard;
// site/own-chat.mjs is where they started.
export const OWN_BUTTON = '<script src="https://saygday.ai/widget.js" data-business="saygday" data-pulse defer></script>'

export function foot() {
  return `<footer class="site-foot">
  <div class="wrap foot">
    <div class="foot__top">
      <span>Copyright © 2026 SayGday.ai - All rights reserved.</span>
      <nav class="foot__links" aria-label="More from SayGday"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/login">Log in</a></nav>
    </div>
    <p class="foot__country">SayGday.ai acknowledges the Traditional Owners of the lands on which we work. We pay our respects to Elders past and present. We recognise their connection to our land, and we thank them for their contribution to our industry.</p>
  </div>
</footer>
${OWN_BUTTON}`
}

// A page's source with the shared parts filled in. Every marker must be there
// exactly once: a page missing its footer is a mistake, not a choice.
export function composePage(html, slug) {
  const parts = { head: head(), bar: bar(slug), foot: foot() }
  let out = html
  for (const [name, content] of Object.entries(parts)) {
    const marker = `<!-- site:${name} -->`
    const count = out.split(marker).length - 1
    if (count !== 1) throw new Error(`site/${slug || 'index'}: expected one ${marker}, found ${count}`)
    out = out.replace(marker, () => content)
  }
  return out
}
