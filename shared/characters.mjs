// The look of the chat button (carried over from the earlier platform's
// shared/assistant-characters.mjs): a plain button by default, or one of the
// eight SayGday characters, "the mob". One list, read by the database check,
// the server, the dashboard, the chat and the button.
export const DEFAULT_CHARACTER = 'bubble'

export const CHARACTERS = Object.freeze([
  { key: 'skippy', name: 'Skippy', animal: 'kangaroo' },
  { key: 'quigley', name: 'Quigley', animal: 'quokka' },
  { key: 'eddie', name: 'Eddie', animal: 'echidna' },
  { key: 'kiki', name: 'Kiki', animal: 'kookaburra' },
  { key: 'kip', name: 'Kip', animal: 'koala' },
  { key: 'penny', name: 'Penny', animal: 'platypus' },
  { key: 'sully', name: 'Sully', animal: 'sugar glider' },
  { key: 'wally', name: 'Wally', animal: 'wombat' },
].map(Object.freeze))

// Plain buttons (owner, 2 October 2026: "can you create some more versions
// for people - circles - + symbols etc"): a simple shape on SayGday green for
// a business that wants something quieter than the mob. The website's Meet the
// mob page shows the same fifteen. Each glyph is drawn on a 24 by 24 grid in
// the button's colour; public/widget.js keeps an exact copy, because a
// business's website loads it as a plain script (test/characters.test.mjs).
const dot = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`
const BUBBLE = '<path d="M20 12a8 8 0 01-11.6 7.1L4 20l1-4.1A8 8 0 1120 12z"/>'
export const PLAIN_BUTTONS = Object.freeze([
  { key: 'bubble', name: 'Chat bubble', glyph: BUBBLE },
  { key: 'typing', name: 'Typing', glyph: BUBBLE + dot(8.4, 12, 1.15) + dot(12, 12, 1.15) + dot(15.6, 12, 1.15) },
  { key: 'bubbles', name: 'Two bubbles', glyph: '<path d="M5.5 3.5h7a3 3 0 013 3V10a3 3 0 01-3 3H8.5L5 15.8V12.9A3 3 0 012.5 10V6.5a3 3 0 013-3z"/><path d="M18.5 8.5a3 3 0 013 3V15a3 3 0 01-2.5 2.96V20.8L15.5 18h-3a3 3 0 01-3-3"/>' },
  { key: 'gday', name: 'G’day', glyph: '<text x="12" y="15.2" text-anchor="middle" fill="currentColor" stroke="none" font-family="Outfit, system-ui, -apple-system, Segoe UI, sans-serif" font-size="8.6" font-weight="700">G&#8217;day</text>' },
  { key: 'hi', name: 'Hi', glyph: '<path d="M6.5 7v10M6.5 12h5.5M12 7v10M17.2 11v6" stroke-width="2.5"/>' + dot(17.2, 7.4, 1.5) },
  {"key":"wave","name":"Waving hand","glyph":"<path d=\"M8 12V5.5a1.5 1.5 0 013 0V11M11 10V4.5a1.5 1.5 0 013 0V11M14 10V6a1.5 1.5 0 013 0v7M17 11V9a1.5 1.5 0 013 0v6a6 6 0 01-6 6h-1c-2.5 0-4-1.4-5.5-3.3L4 13.5a1.5 1.5 0 012.2-2L8 13\"/><path d=\"M2 7a6 6 0 012-4M3 20l2 1\"/>"},
  { key: 'question', name: 'Question', glyph: '<path d="M9 9.2a3 3 0 115.2 2c-.9.9-2.2 1.3-2.2 2.9v.5" stroke-width="2.4"/>' + dot(12, 17.8, 1.35) },
  { key: 'plus', name: 'Plus', glyph: '<path d="M12 5.5v13M5.5 12h13" stroke-width="2.6"/>' },
  { key: 'smile', name: 'Smile', glyph: '<circle cx="12" cy="12" r="8.6"/><path d="M8.6 13.9a4.2 4.2 0 006.8 0"/>' + dot(9.3, 9.9, 1.15) + dot(14.7, 9.9, 1.15) },
  { key: 'heart', name: 'Heart', glyph: '<path d="M12 19.4s-7.6-4.3-7.6-9.6A4.1 4.1 0 0112 7.6a4.1 4.1 0 017.6 2.2c0 5.3-7.6 9.6-7.6 9.6z"/>' },
  { key: 'ring', name: 'Ring', glyph: '<circle cx="12" cy="12" r="7.2" stroke-width="2.6"/>' },
  { key: 'dot', name: 'Dot', glyph: dot(12, 12, 6.4) },
  { key: 'ring-dot', name: 'Ring and dot', glyph: '<circle cx="12" cy="12" r="8"/>' + dot(12, 12, 3.6) },
  {"key":"info","name":"Information","glyph":"<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v6M10 17h4\"/><circle cx=\"12\" cy=\"7.5\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>"},
  {"key":"lifebuoy","name":"Lifebuoy","glyph":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M5.6 5.6l3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6\"/>"},
].map(Object.freeze))

export const CHARACTER_KEYS = Object.freeze([...PLAIN_BUTTONS.map(button => button.key), ...CHARACTERS.map(character => character.key)])
export const characterFor = key => CHARACTERS.find(character => character.key === key) || null
export const plainFor = key => PLAIN_BUTTONS.find(button => button.key === key) || null
export const characterImage = key => `/characters/${key}.webp`
// A plain button's picture. An unknown look draws the bubble.
export const plainSvg = (key, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(plainFor(key) || PLAIN_BUTTONS[0]).glyph}</svg>`
export const characterLabel = key => {
  const character = characterFor(key)
  if (character) return `${character.name} the ${character.animal}`
  return `A plain button: ${(plainFor(key) || PLAIN_BUTTONS[0]).name}`
}
