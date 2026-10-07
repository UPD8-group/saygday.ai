import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { DEFAULT_BUTTON_COLOUR, buttonColour, buttonInk } from '../shared/button-colour.mjs'
import { CHARACTERS, PLAIN_BUTTONS } from '../shared/characters.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'
import { ownerAction } from '../netlify/functions/_lib/owner.mjs'

test('owner colour persists per business, is public in the verified widget, and survives other settings', async () => {
  const pg = await database()
  const owner = await user(pg)
  const db = rpcClient(pg, { user: owner })
  const call = async (name, args) => { const result = await db.rpc(name, args); if (result.error) throw new Error(result.error.message); return result.data }
  const create = website => call('create_business', { p_user: owner.id, p_email: owner.email, p_website: website })
  const first = await create('https://first.com.au')
  const second = await create('https://second.com.au')
  assert.equal(first.buttonColour, DEFAULT_BUTTON_COLOUR)
  const request = new Request('https://saygday.ai/api/app', { headers: { authorization: 'Bearer test' } })
  const save = body => ownerAction({ request, db, body: { action: 'updateBusiness', business: first.id, ...body }, origin: 'https://saygday.ai' })
  assert.equal((await save({ buttonColour: '#AABBCC', character: 'plus' })).business.buttonColour, '#aabbcc')
  assert.equal((await save({ greeting: 'Hello!', character: 'wally' })).business.buttonColour, '#aabbcc')
  assert.equal((await call('my_business', { p_user: owner.id, p_business: second.id })).buttonColour, DEFAULT_BUTTON_COLOUR)
  await call('mark_website_verified', { p_slug: first.slug, p_website: first.website, p_method: 'button' })
  assert.equal((await call('widget', { p_slug: first.slug })).buttonColour, '#aabbcc')
  for (const colour of ['red', '#fff', '#123456;background:red', null, 123, '']) {
    await assert.rejects(save({ buttonColour: colour }), /colour/)
    assert.ok((await db.rpc('update_business', { p_user: owner.id, p_business: first.id, p_button_colour: colour === null ? '' : colour })).error)
  }
  const stranger = await user(pg)
  assert.ok((await db.rpc('update_business', { p_user: stranger.id, p_business: first.id, p_button_colour: '#ff0000' })).error)
  await pg.exec('set role authenticated')
  await assert.rejects(pg.query("select public.update_business($1, p_business => $2, p_button_colour => '#ff0000')", [owner.id, first.id]), /permission denied/)
})

const luminance = colour => {
  const c = [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722
}
test('light, dark and mid-tone colours get at least 4.5:1 icon contrast', () => {
  for (let rgb = 0; rgb <= 0xffffff; rgb += 997) {
    const colour = '#' + rgb.toString(16).padStart(6, '0')
    const a = luminance(colour), b = luminance(buttonInk(colour))
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, colour)
  }
  assert.equal(buttonColour('url(evil)'), DEFAULT_BUTTON_COLOUR)
})

async function renderWidget(config) {
  const elements = []
  const createElement = tag => {
    const classes = new Set()
    const node = { tag, style: {}, children: [], attributes: {}, listeners: {}, appendChild(child) { this.children.push(child) }, setAttribute(k, v) { this.attributes[k] = v }, addEventListener(k, fn) { this.listeners[k] = fn }, focus() {}, classList: { add(k) { classes.add(k) }, remove(k) { classes.delete(k) }, contains(k) { return classes.has(k) }, toggle(k, value) { value ? classes.add(k) : classes.delete(k) } } }
    elements.push(node)
    return node
  }
  const document = { body: createElement('body'), readyState: 'complete', createElement, addEventListener() {}, currentScript: { src: 'https://saygday.ai/widget.js', getAttribute: () => 'test-business', hasAttribute: () => false } }
  vm.runInNewContext(await readFile(new URL('../public/widget.js', import.meta.url), 'utf8'), { document, window: { addEventListener() {}, setTimeout() { return 1 }, clearTimeout() {} }, URL, location: { origin: 'https://test.com.au' }, fetch: async () => ({ ok: true, json: async () => config }), console })
  await new Promise(resolve => setImmediate(resolve))
  return elements.find(node => node.className === 'sg-button')
}
test('real embed colours every simple look and its close icon; animal images ignore the setting', async () => {
  for (const look of PLAIN_BUTTONS) {
    for (const colour of ['#ffffff', '#000000', '#ffcc00', '#123ABC', 'bad']) {
      const button = await renderWidget({ character: look.key, buttonColour: colour })
      assert.equal(button.style.background, buttonColour(colour))
      assert.equal(button.style.color, buttonInk(colour))
      button.listeners.click()
      assert.equal(button.attributes['aria-expanded'], 'true')
      assert.equal(button.style.color, buttonInk(colour))
    }
  }
  for (const animal of CHARACTERS) {
    const button = await renderWidget({ character: animal.key, buttonColour: '#ff0000' })
    assert.deepEqual(button.style, {})
    assert.equal(button.children[0].src, `https://saygday.ai/characters/${animal.key}.webp`)
  }
})
