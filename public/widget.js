/*
 * SayGday chat button. A business adds one line to its website:
 *
 *   <script src="https://saygday.ai/widget.js" data-business="joes-cafe" defer></script>
 *
 * It draws a button in the bottom-right corner (the business's chosen
 * character, or a plain chat bubble). Tapping it opens the chat in a window
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

  var CHARACTERS = ['skippy', 'quigley', 'eddie', 'kiki', 'kip', 'penny', 'sully', 'wally']
  var BUBBLE = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.1A8 8 0 1120 12z"/></svg>'
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
      '@media (prefers-reduced-motion:reduce){.sg-button{transition:none}}'
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
      bubble.innerHTML = BUBBLE
      button.appendChild(bubble)
    }
    var close = document.createElement('span')
    close.className = 'sg-close'
    close.innerHTML = CLOSE
    button.appendChild(close)

    var frame = null
    function setOpen(open) {
      if (open && !frame) {
        frame = document.createElement('iframe')
        frame.title = 'Questions for ' + (config.name || 'this business')
        frame.src = origin + '/chat.html?business=' + encodeURIComponent(slug)
        frame.setAttribute('loading', 'eager')
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

  // seen=1 lets the dashboard say the button is live on the website.
  fetch(origin + '/api/chat?business=' + encodeURIComponent(slug) + '&seen=1', { credentials: 'omit' })
    .then(function (response) { return response.ok ? response.json() : null })
    .then(function (config) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(config) })
      else start(config)
    })
    .catch(function () { /* No button if SayGday can't be reached: the page is unaffected. */ })
})()
