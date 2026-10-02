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
