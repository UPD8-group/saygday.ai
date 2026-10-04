export const DEFAULT_BUTTON_COLOUR = '#31584a'
export const validButtonColour = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
export const buttonColour = value => validButtonColour(value) ? value.toLowerCase() : DEFAULT_BUTTON_COLOUR

// Pick the higher-contrast black or white glyph (at least 4.58:1).
// public/widget.js carries the same helpers; the widget tests check parity.
export function buttonInk(value) {
  const colour = buttonColour(value)
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(colour.slice(index, index + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
