// What a visitor on a business's website can do through the chat. No AI is
// involved anywhere here: the chat receives the business's approved answers
// and matches questions in the browser (shared/matcher.mjs). The server only
// hands out approved answers, counts which ones were read, and passes on a
// question the chat couldn't answer.
import { HttpError, call, rateLimit } from './runtime.mjs'
import { sendEnquiryEmail } from './email.mjs'

export const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const slugFrom = value => {
  if (typeof value !== 'string' || !SLUG.test(value)) throw new HttpError(404, 'This chat isn’t available.', 'NOT_FOUND')
  return value
}

export async function widgetFor({ db, slug, seen = false }) {
  const widget = await call(db, 'widget', { p_slug: slugFrom(slug) })
  if (!widget) throw new HttpError(404, 'This chat isn’t available.', 'NOT_FOUND')
  if (seen) await db.rpc('button_seen', { p_slug: widget.slug }).then(() => {}, () => {})
  return widget
}

export async function visitorAction({ db, body, ip, dependencies = {} }) {
  const slug = slugFrom(body.business)
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
    const enquiry = await call(db, 'ask_team', { p_slug: slug, p_question: question, p_email: email })
    let emailed = false
    if (email) {
      emailed = await (dependencies.sendEnquiryEmail || sendEnquiryEmail)({ enquiry })
      if (emailed) await db.rpc('enquiry_emailed', { p_id: enquiry.id }).then(() => {}, () => {})
    }
    return { ok: true, sent: Boolean(email) }
  }
  throw new HttpError(400, 'That action isn’t available.', 'UNKNOWN_ACTION')
}
