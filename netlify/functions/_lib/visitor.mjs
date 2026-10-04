// What a visitor on a business's website can do through the chat. No AI is
// involved anywhere here: the chat receives the business's approved answers
// and matches questions in the browser (shared/matcher.mjs). The server only
// hands out approved answers, counts which ones were read, and passes on a
// question the chat couldn't answer.
//
// A chat only runs once its business has proved it owns the website (owner,
// 3 October 2026), and then only on that website: the button's request
// carries the page's Origin, and the chat window says which page holds it.
import { HttpError, call, rateLimit } from './runtime.mjs'
import { emailConfiguration } from './email.mjs'
import { processEnquiryNotifications } from './enquiry-notifications.mjs'
import { checkWebsite, sameSite } from './verify-website.mjs'

export const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const slugFrom = value => {
  if (typeof value !== 'string' || !SLUG.test(value)) throw new HttpError(404, 'This chat isn’t available.', 'NOT_FOUND')
  return value
}

const unavailable = () => new HttpError(404, 'This chat isn’t available.', 'NOT_FOUND')

// The first time the button loads on a website that isn't verified yet, the
// server checks that website itself: when the business's own button code is
// on its home page (or its DNS record is in place), the chat switches on
// there and then. At most twelve checks an hour for a business.
async function verifyOnFirstSight({ db, slug, origin, dependencies }) {
  const target = await call(db, 'verification_target', { p_slug: slug })
  if (!target || !sameSite(target.website, origin)) return null
  try { await rateLimit(db, 'verify-auto', slug, 12, 3600) } catch { return null }
  const { method } = await (dependencies.checkWebsite || checkWebsite)({ website: target.website, slug, token: target.verificationToken })
  if (!method) return null
  const { error } = await db.rpc('mark_website_verified', { p_slug: slug, p_website: target.website, p_method: method })
  if (error) return null
  return call(db, 'widget', { p_slug: slug })
}

// origin: the Origin of the button's request (the business's page). site: the
// page the chat window says it sits in. Either must be the verified website.
export async function widgetFor({ db, slug, seen = false, origin = null, site = null, dependencies = {} }) {
  const valid = slugFrom(slug)
  let widget = await call(db, 'widget', { p_slug: valid })
  if (!widget && seen && origin) widget = await verifyOnFirstSight({ db, slug: valid, origin, dependencies })
  if (!widget || !sameSite(widget.website, origin || site)) throw unavailable()
  if (seen && origin) await db.rpc('button_seen', { p_slug: widget.slug }).then(() => {}, () => {})
  const { website, ...chat } = widget
  return chat
}

export async function visitorAction({ db, body, ip, dependencies = {} }) {
  const slug = slugFrom(body.business)
  if (!sameSite(await call(db, 'chat_website', { p_slug: slug }), body.site)) throw unavailable()
  if (body.action === 'viewed') {
    if (typeof body.faqId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.faqId)) throw new HttpError(400, 'That wasn’t found.', 'INVALID')
    await rateLimit(db, 'viewed', ip, 120, 3600)
    await call(db, 'faq_viewed', { p_slug: slug, p_faq: body.faqId })
    return { ok: true }
  }
  if (body.action === 'ask') {
    // A hidden field people never see: anything in it was filled in by a bot.
    if (typeof body.website === 'string' && body.website.trim()) return { ok: true }
    const question = typeof body.question === 'string' ? body.question.replace(/\s+/g, ' ').trim() : ''
    if (question.length < 2 || question.length > 500) throw new HttpError(400, 'Type your question (up to 500 characters).', 'INVALID_QUESTION')
    const email = typeof body.email === 'string' && body.email.trim() ? body.email.trim().toLowerCase() : null
    if (email && (email.length > 254 || !EMAIL.test(email))) throw new HttpError(400, 'Check your email address, like you@example.com', 'INVALID_EMAIL')
    await rateLimit(db, 'ask', ip, 8, 3600)
    await rateLimit(db, 'ask-business', slug, 200, 86400)
    const configuration = emailConfiguration()
    const enquiry = await call(db, 'ask_team_queued', { p_slug: slug, p_question: question, p_email: email,
      p_sender: configuration.from || null, p_public_url: configuration.publicUrl })
    let notification = email ? 'pending' : 'not_requested'
    if (email) {
      try {
        const results = await processEnquiryNotifications({ db, id: enquiry.id, send: dependencies.sendEnquiryEmail })
        notification = results[0]?.notification || 'pending'
      } catch {
        // Submission succeeded. The scheduler owns recovery; asking the
        // visitor to submit again here would create a duplicate enquiry.
        console.error('Enquiry notification deferred')
      }
    }
    return { ok: true, sent: notification === 'sent', notification }
  }
  throw new HttpError(400, 'That action isn’t available.', 'UNKNOWN_ACTION')
}
