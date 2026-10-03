/*
 * SayGday chat button. A business adds one line to its website:
 *
 *   <script src="https://saygday.ai/widget.js" data-business="joes-cafe" defer></script>
 *
 * Add data-pulse to the tag and a soft gold ring pulses around the button
 * until the visitor first opens the chat (never for anyone who asks their
 * device for less motion). saygday.ai's own chat does.
 *
 * It draws a button in the bottom-right corner (the business's chosen
 * character, or a plain button). Tapping it opens the chat in a window
 * served from SayGday, so nothing on the business's own page can read or
 * change it, and nothing in it can touch the business's page. The chat only
 * shows answers the business approved. No AI answers visitors.
 */
(function () {
  'use strict'
  if (window.__saygdayButton) return
  var script = document.currentScript
  if (!script) return
  var slug = (script.getAttribute('data-business') || '').trim()
  var origin
  try { origin = new URL(script.src).origin } catch (e) { return }
  if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) { console.warn('[SayGday] Add data-business="your-business" to the script tag.'); return }
  window.__saygdayButton = true
  var pulse = script.hasAttribute('data-pulse')
  var OPENED = 'saygday-opened:' + slug

  var CHARACTERS = ['skippy', 'quigley', 'eddie', 'kiki', 'kip', 'penny', 'sully', 'wally']
  // The plain buttons: an exact copy of PLAIN_BUTTONS in shared/characters.mjs
  // (this file runs on a business's website as a plain script, so it can't
  // import it). test/characters.test.mjs keeps the two the same.
  var PLAIN = {
    'bubble': '<path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.1A8 8 0 1120 12z"/>',
    'typing': '<path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.1A8 8 0 1120 12z"/><circle cx="8.4" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/><circle cx="15.6" cy="12" r="1.15" fill="currentColor" stroke="none"/>',
    'bubbles': '<path d="M5.5 3.5h7a3 3 0 013 3V10a3 3 0 01-3 3H8.5L5 15.8V12.9A3 3 0 012.5 10V6.5a3 3 0 013-3z"/><path d="M18.5 8.5a3 3 0 013 3V15a3 3 0 01-2.5 2.96V20.8L15.5 18h-3a3 3 0 01-3-3"/>',
    'gday': '<text x="12" y="15.2" text-anchor="middle" fill="currentColor" stroke="none" font-family="Outfit, system-ui, -apple-system, Segoe UI, sans-serif" font-size="8.6" font-weight="700">G&#8217;day</text>',
    'hi': '<path d="M6.5 7v10M6.5 12h5.5M12 7v10M17.2 11v6" stroke-width="2.5"/><circle cx="17.2" cy="7.4" r="1.5" fill="currentColor" stroke="none"/>',
    'question': '<path d="M9 9.2a3 3 0 115.2 2c-.9.9-2.2 1.3-2.2 2.9v.5" stroke-width="2.4"/><circle cx="12" cy="17.8" r="1.35" fill="currentColor" stroke="none"/>',
    'plus': '<path d="M12 5.5v13M5.5 12h13" stroke-width="2.6"/>',
    'smile': '<circle cx="12" cy="12" r="8.6"/><path d="M8.6 13.9a4.2 4.2 0 006.8 0"/><circle cx="9.3" cy="9.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="14.7" cy="9.9" r="1.15" fill="currentColor" stroke="none"/>',
    'heart': '<path d="M12 19.4s-7.6-4.3-7.6-9.6A4.1 4.1 0 0112 7.6a4.1 4.1 0 017.6 2.2c0 5.3-7.6 9.6-7.6 9.6z"/>',
    'ring': '<circle cx="12" cy="12" r="7.2" stroke-width="2.6"/>',
    'dot': '<circle cx="12" cy="12" r="6.4" fill="currentColor" stroke="none"/>',
    'ring-dot': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>'
  }
  function plainSvg(key) {
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (PLAIN.hasOwnProperty(key) ? PLAIN[key] : PLAIN.bubble) + '</svg>'
  }
  var CLOSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'

  function start(config) {
    if (!config || !document.body) return
    var host = document.createElement('div')
    host.setAttribute('data-saygday', '')
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
    var style = document.createElement('style')
    style.textContent =
      ':host{all:initial}' +
      '.sg-button{position:fixed;right:20px;bottom:20px;z-index:2147483000;width:64px;height:64px;border-radius:50%;border:0;padding:0;cursor:pointer;' +
      'background:#31584a;color:#fff;display:grid;place-items:center;box-shadow:0 10px 28px rgba(20,33,28,.28);transition:transform .15s ease}' +
      '.sg-button:hover{transform:scale(1.05)}.sg-button:focus-visible{outline:3px solid #f3c969;outline-offset:3px}' +
      '.sg-button img{width:64px;height:64px;border-radius:50%;display:block;background:#fff}' +
      '.sg-button.is-open img{display:none}.sg-close{display:none}.sg-button.is-open .sg-close{display:block}.sg-button.is-open .sg-bubble{display:none}' +
      '.sg-panel{position:fixed;right:20px;bottom:96px;z-index:2147483000;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 120px);' +
      'border:0;border-radius:20px;overflow:hidden;box-shadow:0 18px 48px rgba(20,33,28,.25);background:#fbfaf6;display:none}' +
      '.sg-panel.is-open{display:block}.sg-panel iframe{border:0;width:100%;height:100%;display:block}' +
      '@media (max-width:520px){.sg-panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.sg-button.is-open{display:none}}' +
      '.sg-button.sg-pulse{animation:sg-pulse 2.8s ease-out infinite}' +
      '@keyframes sg-pulse{0%{box-shadow:0 10px 28px rgba(20,33,28,.28),0 0 0 0 rgba(243,201,105,.8)}' +
      '70%{box-shadow:0 10px 28px rgba(20,33,28,.28),0 0 0 18px rgba(243,201,105,0)}100%{box-shadow:0 10px 28px rgba(20,33,28,.28),0 0 0 0 rgba(243,201,105,0)}}' +
      '@media (prefers-reduced-motion:reduce){.sg-button{transition:none}.sg-button.sg-pulse{animation:none}}'
    root.appendChild(style)

    var panel = document.createElement('div')
    panel.className = 'sg-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', 'Questions for ' + (config.name || 'this business'))

    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'sg-button'
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-label', 'Questions? Ask ' + (config.name || 'us'))
    if (CHARACTERS.indexOf(config.character) >= 0) {
      var image = document.createElement('img')
      image.src = origin + '/characters/' + config.character + '.webp'
      image.alt = ''
      button.appendChild(image)
    } else {
      var bubble = document.createElement('span')
      bubble.className = 'sg-bubble'
      bubble.innerHTML = plainSvg(config.character)
      button.appendChild(bubble)
    }
    // The pulse stops for good once the chat has been opened on this visit.
    var pulsing = pulse
    try { if (window.sessionStorage.getItem(OPENED)) pulsing = false } catch (e) { /* storage blocked: keep pulsing */ }
    if (pulsing) button.classList.add('sg-pulse')
    var close = document.createElement('span')
    close.className = 'sg-close'
    close.innerHTML = CLOSE
    button.appendChild(close)

    var frame = null
    function setOpen(open) {
      if (open && pulsing) {
        pulsing = false
        button.classList.remove('sg-pulse')
        try { window.sessionStorage.setItem(OPENED, '1') } catch (e) { /* storage blocked */ }
      }
      if (open && !frame) {
        frame = document.createElement('iframe')
        frame.title = 'Questions for ' + (config.name || 'this business')
        frame.src = origin + '/chat.html?business=' + encodeURIComponent(slug)
        frame.setAttribute('loading', 'eager')
        // The chat only runs on the business's verified website, so it needs
        // to know which website holds it, even where the page sends no
        // referrer by default.
        frame.setAttribute('referrerpolicy', 'origin')
        panel.appendChild(frame)
      }
      panel.classList.toggle('is-open', open)
      button.classList.toggle('is-open', open)
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      button.setAttribute('aria-label', open ? 'Close questions' : 'Questions? Ask ' + (config.name || 'us'))
      if (!open) button.focus()
    }
    button.addEventListener('click', function () { setOpen(!panel.classList.contains('is-open')) })
    window.addEventListener('message', function (event) {
      if (event.origin === origin && event.data && event.data.source === 'saygday' && event.data.type === 'close') setOpen(false)
    })
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && panel.classList.contains('is-open')) setOpen(false) })
    root.appendChild(panel)
    root.appendChild(button)
    document.body.appendChild(host)
  }

  // seen=1 lets the dashboard say the button is live on the website. site=
  // says which page holds the button: the server goes by the request's
  // Origin whenever the browser sends one, so this only counts where it
  // doesn't, on SayGday's own website, whose chat lives on saygday.ai.
  fetch(origin + '/api/chat?business=' + encodeURIComponent(slug) + '&site=' + encodeURIComponent(location.origin) + '&seen=1', { credentials: 'omit' })
    .then(function (response) { return response.ok ? response.json() : null })
    .then(function (config) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(config) })
      else start(config)
    })
    .catch(function () { /* No button if SayGday can't be reached: the page is unaffected. */ })
})()
