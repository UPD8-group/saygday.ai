// The look of the chat button (carried over from the earlier platform's
// shared/assistant-characters.mjs): a plain chat bubble by default, or one of
// the eight SayGday characters, "the mob". One list, read by the database
// check, the server, the dashboard, the chat and the button.
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

export const CHARACTER_KEYS = Object.freeze([DEFAULT_CHARACTER, ...CHARACTERS.map(character => character.key)])
export const characterFor = key => CHARACTERS.find(character => character.key === key) || null
export const characterImage = key => `/characters/${key}.webp`
export const characterLabel = key => {
  const character = characterFor(key)
  return character ? `${character.name} the ${character.animal}` : 'A simple chat bubble'
}
