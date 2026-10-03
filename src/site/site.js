// The public website's menu: the burger opens it over the page; a link, the
// burger again, or Escape closes it.
const burger = document.getElementById('burger')
const menu = document.getElementById('menu')

if (burger && menu) {
  const setMenu = open => {
    menu.hidden = !open
    burger.setAttribute('aria-expanded', String(open))
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    document.body.classList.toggle('menu-open', open)
    if (open) menu.querySelector('a')?.focus()
  }
  burger.addEventListener('click', () => {
    setMenu(menu.hidden)
    if (menu.hidden) burger.focus()
  })
  menu.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false) })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { setMenu(false); burger.focus() }
  })
  // A page restored from the back/forward cache comes back with its menu shut.
  window.addEventListener('pageshow', () => setMenu(false))
}

// The contact form (site/contact.html) is a Netlify form. Without JavaScript
// it posts to /thanks; with it, it sends the same fields in place and says
// thanks where the form was.
const contact = document.querySelector('form[name="contact"]')
const thanks = document.getElementById('contact-thanks')

if (contact && thanks) {
  const status = contact.querySelector('[data-status]')
  const send = contact.querySelector('button[type="submit"]')
  contact.addEventListener('submit', async event => {
    event.preventDefault()
    send.disabled = true
    send.textContent = 'Sending…'
    status.textContent = ''
    try {
      const response = await fetch(contact.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(contact)).toString(),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      contact.hidden = true
      thanks.hidden = false
      thanks.querySelector('h2').focus()
    } catch {
      status.textContent = 'That didn’t send. Please check your connection and try again.'
      send.disabled = false
      send.textContent = 'Send message'
    }
  })
}

// On a phone each page shows its short version first, and Learn more opens
// the rest (owner, 3 October 2026). The rest is every element marked "more";
// on a wider screen it is always open and the button isn't shown.
const bodies = [...document.querySelectorAll('.more')]
for (const button of document.querySelectorAll('[data-more]')) {
  const label = button.querySelector('span')
  button.setAttribute('aria-controls', bodies.map(body => body.id).join(' '))
  const setMore = open => {
    button.setAttribute('aria-expanded', String(open))
    label.textContent = open ? 'Show less' : 'Learn more'
    for (const body of bodies) body.classList.toggle('is-open', open)
  }
  button.addEventListener('click', () => setMore(button.getAttribute('aria-expanded') !== 'true'))
  // A link to something in the rest of the page opens it.
  const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)))
  if (target && bodies.some(body => body.contains(target))) { setMore(true); target.scrollIntoView() }
}
