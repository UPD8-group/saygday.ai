import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { CHARACTERS, CHARACTER_KEYS, DEFAULT_CHARACTER, PLAIN_BUTTONS, characterLabel, plainSvg } from '../shared/characters.mjs'
import { database, rpcClient, user } from './helpers/database.mjs'

// The looks a chat button can have: the mob, and fifteen plain buttons (the
// same fifteen the website's Meet the mob page shows).
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('fifteen plain buttons beside the mob, the bubble first and still the default', () => {
  assert.deepEqual(PLAIN_BUTTONS.map(button => button.name), ['Chat bubble', 'Typing', 'Two bubbles', 'G’day', 'Hi', 'Waving hand', 'Question', 'Plus', 'Smile', 'Heart', 'Ring', 'Dot', 'Ring and dot', 'Information', 'Lifebuoy'])
  assert.equal(PLAIN_BUTTONS[0].key, DEFAULT_CHARACTER)
  assert.equal(CHARACTER_KEYS.length, 23)
  assert.equal(new Set(CHARACTER_KEYS).size, 23, 'no two looks share a key')
  assert.equal(characterLabel('smile'), 'A plain button: Smile')
  assert.equal(characterLabel('wally'), 'Wally the wombat')
  assert.equal(plainSvg('nothing-like-this', 20), plainSvg('bubble', 20), 'an unknown look draws the bubble')
  assert.equal(characterLabel('nothing-like-this'), 'A plain button: Chat bubble')
})

test('the button on a business’s website draws exactly the same fifteen', async () => {
  const widget = await read('public/widget.js')
  const table = widget.slice(widget.indexOf('var PLAIN = {'), widget.indexOf('\n  }\n', widget.indexOf('var PLAIN = {')))
  const drawn = Object.fromEntries([...table.matchAll(/^\s+'([a-z-]+)': '(.*)',?$/gm)].map(([, key, glyph]) => [key, glyph]))
  assert.deepEqual(drawn, Object.fromEntries(PLAIN_BUTTONS.map(button => [button.key, button.glyph])), 'public/widget.js keeps an exact copy')
  assert.match(widget, /var CHARACTERS = \[([^\]]+)\]/)
  assert.deepEqual(widget.match(/var CHARACTERS = \[([^\]]+)\]/)[1].split(',').map(item => item.trim().replace(/'/g, '')), CHARACTERS.map(character => character.key))
  assert.match(widget, /bubble\.innerHTML = plainSvg\(config\.character\)/)
  assert.match(widget, /PLAIN\.hasOwnProperty\(key\) \? PLAIN\[key\] : PLAIN\.bubble/, 'a look the widget doesn’t know draws the bubble')
  assert.doesNotMatch(widget, /[^\x00-\x7F]/, 'plain ASCII only: a business’s page may not be UTF-8, and G’day came out as “Gâ€™day” on one that wasn’t')
})

test('the database accepts every look, and nothing else', async () => {
  const migration = await read('supabase/migrations/20261009142742_friendly_chat_icons.sql')
  const listed = migration.match(/check \(character in \(([^)]*)\)\)/)[1].match(/'([^']+)'/g).map(item => item.slice(1, -1))
  assert.deepEqual(listed.sort(), [...CHARACTER_KEYS].sort())
  const pg = await database()
  const db = rpcClient(pg)
  const owner = await user(pg)
  await db.rpc('create_business', { p_user: owner.id, p_email: owner.email, p_website: 'https://joescafe.com.au', p_name: 'Joe’s Cafe' })
  for (const key of CHARACTER_KEYS) {
    const { data, error } = await db.rpc('update_business', { p_user: owner.id, p_character: key })
    assert.equal(error, null, key)
    assert.equal(data.character, key)
  }
  const { error } = await db.rpc('update_business', { p_user: owner.id, p_character: 'unicorn' })
  assert.ok(error, 'a look that doesn’t exist is refused')
})
