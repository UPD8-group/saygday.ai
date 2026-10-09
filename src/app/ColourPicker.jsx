import { useEffect, useState } from 'react'
import { Avatar } from '../chat/Chat.jsx'
import { Button, Field, Icon } from './ui.jsx'
import { DEFAULT_BUTTON_COLOUR, buttonColour, buttonInk } from '../../shared/button-colour.mjs'
import { plainFor } from '../../shared/characters.mjs'

const COLOURS = [
  ['Forest', '#31584a'], ['Teal', '#007f82'], ['Sky', '#247bc1'], ['Navy', '#203e67'],
  ['Purple', '#7654a4'], ['Pink', '#c64a79'], ['Red', '#c44136'], ['Orange', '#df782f'],
  ['Gold', '#e3b74e'], ['Lime', '#8aa94e'], ['Mint', '#9ccab5'], ['Sand', '#d4b895'],
  ['Charcoal', '#303538'], ['Grey', '#7e8589'], ['Black', '#000000'], ['White', '#ffffff'],
]

function toHsl(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(buttonColour(hex).slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  const l = (max + min) / 2
  let h = 0
  if (d) h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, d ? d / (1 - Math.abs(2 * l - 1)) * 100 : 0, l * 100]
}
function toHex([h, s, l]) {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const channel = n => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return '#' + channel(0) + channel(8) + channel(4)
}

export default function ColourPicker({ value, onChange, character, animal }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value)
  const colour = buttonColour(value)
  const [hsl, setHsl] = useState(() => toHsl(colour))
  useEffect(() => { if (valid && toHex(hsl) !== colour) setHsl(toHsl(colour)) }, [colour, valid])
  function adjust(index, nextValue) {
    const next = hsl.map((part, i) => i === index ? Number(nextValue) : part)
    setHsl(next); onChange(toHex(next))
  }
  return <section className="card colour-picker" aria-label="Button colour">
    <h2>Button colour</h2>
    <p>{animal ? 'The Mob keeps its original artwork. Pick a chat or symbol icon to use your colour.' : 'Choose a colour below, or fine-tune your own.'}</p>
    <div className="colour-picker__chosen"><Avatar character={animal ? 'bubble' : character} size={72} colour={colour} /><div><strong>{animal ? 'Colour for chat & symbol icons' : plainFor(character)?.name || 'Chat bubble'}</strong><span>{valid ? colour.toUpperCase() : 'Enter a colour code below'}</span></div></div>
    <div className="colour-picker__swatches" role="group" aria-label="Colour choices">{COLOURS.map(([name, hex]) => <button key={hex} type="button" className="colour-swatch" style={{background: hex, color: buttonInk(hex)}} aria-label={name} aria-pressed={colour === hex && valid} title={name} onClick={() => onChange(hex)}>{colour === hex && valid && <Icon name="check" size={20} />}</button>)}</div>
    <div className="colour-picker__sliders">
      <Field label="Colour" hint="Move along the rainbow.">{id => <input id={id} aria-label="Colour hue" className="colour-range colour-range--hue" type="range" min="0" max="360" step="1" value={hsl[0]} onChange={event => adjust(0, event.target.value)} />}</Field>
      <Field label="Colour intensity">{id => <input id={id} className="colour-range" style={{background: 'linear-gradient(to right, hsl(' + hsl[0] + ',0%,50%), hsl(' + hsl[0] + ',100%,50%))'}} type="range" min="0" max="100" step="1" value={hsl[1]} onChange={event => adjust(1, event.target.value)} />}</Field>
      <Field label="Lightness">{id => <input id={id} className="colour-range" style={{background: 'linear-gradient(to right, #000, hsl(' + hsl[0] + ',' + hsl[1] + '%,50%), #fff)'}} type="range" min="0" max="100" step="1" value={hsl[2]} onChange={event => adjust(2, event.target.value)} />}</Field>
    </div>
    <Field label="Colour code" hint="Have a brand colour? Enter its six-digit code, starting with #." error={!valid ? 'Use a code such as #31584A.' : ''}>{(id, note) => <input id={id} className="input" type="text" value={value.toUpperCase()} onChange={event => onChange(event.target.value.toLowerCase())} maxLength={7} spellCheck={false} aria-describedby={note} aria-invalid={!valid} />}</Field>
    <Button kind="ghost" size="small" onClick={() => onChange(DEFAULT_BUTTON_COLOUR)} disabled={colour === DEFAULT_BUTTON_COLOUR && valid}>Reset colour</Button>
    <p className="small">The icon adjusts automatically to stay readable. Save your changes to apply them.</p>
  </section>
}
