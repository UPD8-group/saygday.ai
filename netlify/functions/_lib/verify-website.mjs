// Proving a business owns its website before its chat goes live (owner,
// 3 October 2026). Two ways, either is enough:
//   * the button: the website's home page carries this business's own chat
//     button code (<script src=".../widget.js" data-business="its-slug">).
//     Only someone who can edit the website can put it there, and the code is
//     what the owner pastes in anyway, so installing it is the proof;
//   * DNS: a TXT record "saygday-verification=<token>" on the website's
//     domain, for websites where we can't see the code (a tag manager adds it,
//     or the home page turns automated visitors away).
// The database keeps the result (supabase/migrations/20261003100000_website_verification.sql).
import { resolveTxt } from 'node:dns/promises'
import { parse } from 'parse5'
import { safeHtml } from './safe-fetch.mjs'

export const TXT_PREFIX = 'saygday-verification='
export const txtRecord = token => `${TXT_PREFIX}${token}`

// A website with or without www is the same website.
export function siteKey(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch { return null }
}
export const sameSite = (website, claimed) => Boolean(siteKey(website) && siteKey(website) === siteKey(claimed))

// The chat button's own code, served by SayGday.
const WIDGET_SRC = /^(?:https:)?\/\/(?:www\.)?(?:saygday\.ai|saygdayai\.netlify\.app)\/widget\.js(?:[?#].*)?$/i
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value
function* elements(node) {
  if (node.tagName) yield node
  for (const child of node.childNodes || []) yield* elements(child)
  if (node.content) yield* elements(node.content)
}

// Only a real <script> element counts: the same code written as text (in a
// blog comment, say) is not someone adding the button to their website.
export function hasButton(html, slug) {
  for (const node of elements(parse(String(html || '')))) {
    if (node.tagName !== 'script') continue
    if (WIDGET_SRC.test((attribute(node, 'src') || '').trim()) && (attribute(node, 'data-business') || '').trim() === slug) return true
  }
  return false
}

const twin = website => {
  const url = new URL(website)
  url.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`
  return url.origin
}
const within = (promise, ms) => {
  let timer
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })]).finally(() => clearTimeout(timer))
}

// Looks for the proof. method is 'button', 'dns' or null; when null, reason
// says what to tell the owner: 'missing' (we read the page, no button),
// 'blocked' (the website turned us away) or 'unreachable'.
export async function checkWebsite({ website, slug, token, dependencies = {} }) {
  const fetchHtml = dependencies.safeHtml || safeHtml
  const lookupTxt = dependencies.resolveTxt || resolveTxt
  const deadline = Date.now() + (dependencies.timeoutMs || 6500)
  const outcomes = []
  const onPage = (async () => {
    // https://joescafe.com.au may send visitors on to www.joescafe.com.au, or
    // the other way round; either is the business's home page.
    for (const address of [website, twin(website)]) {
      try {
        const { html } = await fetchHtml(`${address}/`, { deadline })
        outcomes.push('read')
        if (hasButton(html, slug)) return true
      } catch (error) { outcomes.push(error?.code === 'WEBSITE_ACCESS_BLOCKED' ? 'blocked' : 'unreachable') }
    }
    return false
  })()
  const inDns = (async () => {
    if (!/^[0-9a-f]{32}$/.test(token || '')) return false
    try {
      const records = await within(lookupTxt(siteKey(website)), Math.max(1, deadline - Date.now()))
      return records.some(parts => [].concat(parts).join('').trim() === txtRecord(token))
    } catch { return false }
  })()
  const [button, dns] = await Promise.all([onPage, inDns])
  if (button) return { method: 'button' }
  if (dns) return { method: 'dns' }
  return { method: null, reason: outcomes.includes('read') ? 'missing' : outcomes.includes('blocked') ? 'blocked' : 'unreachable' }
}
