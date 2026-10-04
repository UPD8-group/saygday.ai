import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../public/widget.js', import.meta.url), 'utf8')
async function widget({ storage = new Map(), reduced = false, blocked = false, pulse = null, slug = 'test-cafe', character = 'plus', colour = '#cc3366' } = {}) {
  const elements = [], timers = new Map()
  let sequence = 0
  function element(tag) {
    const classes = new Set()
    const node = { tag, style: {}, children: [], listeners: {}, attributes: {},
      contentWindow: { postMessage() {} },
      appendChild(child) { this.children.push(child) },
      setAttribute(key, value) { this.attributes[key] = value },
      addEventListener(key, fn) { this.listeners[key] = fn }, focus() {},
      classList: { add(key) { classes.add(key) }, remove(key) { classes.delete(key) }, contains(key) { return classes.has(key) }, toggle(key, on) { on ? classes.add(key) : classes.delete(key) } },
    }
    elements.push(node)
    return node
  }
  const document = { body: element('body'), readyState: 'complete', createElement: element, addEventListener() {},
    currentScript: { src: 'https://saygday.ai/widget.js', getAttribute: key => key === 'data-business' ? slug : pulse },
  }
  const window = { addEventListener() {}, matchMedia: () => ({ matches: reduced }),
    sessionStorage: { getItem(key) { if (blocked) throw Error('blocked'); return storage.get(key) }, setItem(key, value) { if (blocked) throw Error('blocked'); storage.set(key, value) } },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id }, clearTimeout(id) { timers.delete(id) },
  }
  vm.runInNewContext(source, { document, window, URL, location: { origin: 'https://client.com.au' }, console,
    fetch: async () => ({ ok: true, json: async () => ({ character, buttonColour: colour }) }),
  })
  await new Promise(resolve => setImmediate(resolve))
  return { button: elements.find(e => e.className === 'sg-button'), css: elements.find(e => e.tag === 'style').textContent, timers, storage }
}

test('ordinary client embed pulses by default, softly three times, with the business colour', async () => {
  const { button, css, timers } = await widget()
  assert.equal(button.classList.contains('sg-pulse'), true)
  assert.match(css, /--sg-pulse-colour:#cc3366/)
  assert.match(css, /sg-pulse 3\.2s ease-out 3/)
  assert.match(css, /20%\{opacity:\.26\}/)
  assert.doesNotMatch(css, /infinite/)
  assert.match(css, /pointer-events:none/)
  assert.equal([...timers.values()][0].delay, 9600)
  const animal = await widget({ character: 'wally' })
  assert.match(animal.css, /--sg-pulse-colour:#f3c969/)
  assert.equal(animal.button.children[0].src, 'https://saygday.ai/characters/wally.webp')
})

test('engagement stops the pulse, clears its timer and remembers it after page navigation', async () => {
  const first = await widget()
  first.button.listeners.click()
  assert.equal(first.button.classList.contains('sg-pulse'), false)
  assert.equal(first.timers.size, 0)
  assert.equal(first.button.attributes['aria-expanded'], 'true')
  assert.equal(first.storage.get('saygday-opened:test-cafe'), '1')
  first.button.listeners.click()
  assert.equal(first.button.classList.contains('sg-pulse'), false)
  assert.equal((await widget({ storage: first.storage })).button.classList.contains('sg-pulse'), false)
})

test('animation completion or timeout stops the ring; it stays stopped across page navigation', async () => {
  const ended = await widget()
  ended.button.listeners.animationend({ animationName: 'unrelated' })
  assert.equal(ended.button.classList.contains('sg-pulse'), true)
  ended.button.listeners.animationend({ animationName: 'sg-pulse' })
  assert.equal(ended.button.classList.contains('sg-pulse'), false)
  assert.equal(ended.timers.size, 0)
  const timed = await widget()
  ;[...timed.timers.values()][0].fn()
  assert.equal(timed.button.classList.contains('sg-pulse'), false)
  timed.button.listeners.click()
  assert.equal(timed.storage.get('saygday-opened:test-cafe'), '1', 'opening after the pulse ends still remembers engagement')
  assert.equal((await widget({ storage: ended.storage })).button.classList.contains('sg-pulse'), false)
  assert.equal((await widget({ storage: ended.storage, slug: 'other-cafe' })).button.classList.contains('sg-pulse'), true)
})

test('reduced motion, prior engagement and opt-out suppress it; blocked storage still limits the pulse', async () => {
  for (const options of [{ reduced: true }, { pulse: 'off' }, { storage: new Map([['saygday-opened:test-cafe', '1']]) }]) {
    const result = await widget(options)
    assert.equal(result.button.classList.contains('sg-pulse'), false)
    assert.equal(result.timers.size, 0)
  }
  const blocked = await widget({ blocked: true, colour: 'bad;css:evil' })
  assert.match(blocked.css, /--sg-pulse-colour:#31584a/)
  ;[...blocked.timers.values()][0].fn()
  blocked.button.listeners.click()
  assert.equal(blocked.button.classList.contains('sg-pulse'), false)
  assert.match(blocked.css, /prefers-reduced-motion:reduce.*::before\{animation:none\}/)
})
