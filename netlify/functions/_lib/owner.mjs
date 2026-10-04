// Everything the business owner's dashboard can do. Each request carries the
// owner's sign-in; the database functions only ever touch that person's own
// business.
import { HttpError, call, rateLimit, requireUser } from './runtime.mjs'
import { startScan } from './scan.mjs'
import { checkWebsite } from './verify-website.mjs'
import { CHARACTER_KEYS } from '../../../shared/characters.mjs'

const text = (value, { max, min = 0, field }) => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new HttpError(400, `Check the ${field}.`, 'INVALID')
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) throw new HttpError(400, min ? `The ${field} needs between ${min} and ${max} characters.` : `The ${field} can be up to ${max} characters.`, 'INVALID')
  return trimmed
}
const id = value => {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new HttpError(400, 'That wasn’t found. Refresh and try again.', 'INVALID_ID')
  return value
}

// "joescafe.com.au", "www.joescafe.com.au/menu" and "https://joescafe.com.au/"
// all mean https://joescafe.com.au: the scan starts at the home page.
export function websiteFrom(value) {
  const raw = text(value, { max: 300, min: 4, field: 'website address' })
  if (!raw) throw new HttpError(400, 'Enter your website’s address.', 'INVALID_WEBSITE')
  let url
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { throw new HttpError(400, 'Enter your website’s address, like joescafe.com.au', 'INVALID_WEBSITE') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== '443' && url.port !== '80') || !url.hostname.includes('.'))
    throw new HttpError(400, 'Enter your website’s address, like joescafe.com.au', 'INVALID_WEBSITE')
  return `https://${url.hostname.toLowerCase()}`
}

function variantsFrom(value) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length > 12 || value.some(item => typeof item !== 'string' || item.length > 200)) throw new HttpError(400, 'Check the other ways of asking.', 'INVALID')
  return value.map(item => item.trim()).filter(Boolean)
}

export const OWNER_ACTIONS = Object.freeze(['me', 'createBusiness', 'startScan', 'scanStatus', 'listFaqs', 'saveFaq', 'deleteFaq', 'approveAll',
  'updateBusiness', 'listEnquiries', 'setEnquiry', 'deleteEnquiry', 'verifyWebsite'])

export async function ownerAction({ request, db, body, origin, dependencies = {} }) {
  const user = await requireUser(request, db)
  const action = body.action
  if (!OWNER_ACTIONS.includes(action)) throw new HttpError(400, 'That action isn’t available.', 'UNKNOWN_ACTION')
  await rateLimit(db, 'owner', user.id, 120, 60)
  const p_user = user.id
  switch (action) {
    case 'me': {
      const business = await call(db, 'my_business', { p_user })
      return { email: user.email, business, scan: business ? await call(db, 'latest_scan', { p_user }) : null }
    }
    case 'createBusiness': {
      const website = websiteFrom(body.website)
      const name = text(body.name, { max: 120, field: 'business name' }) || null
      // One business per account: a second request (a double tap, a reload
      // mid-request) gets the business it already has, and no second scan.
      const existing = await call(db, 'my_business', { p_user })
      if (existing) return { business: existing, scan: await call(db, 'latest_scan', { p_user }) }
      const business = await call(db, 'create_business', { p_user, p_email: user.email, p_website: website, p_name: name })
      const scan = await (dependencies.startScan || startScan)({ db, user, website: business.website, origin })
      return { business: await call(db, 'my_business', { p_user }), scan }
    }
    case 'startScan': {
      const current = await call(db, 'my_business', { p_user })
      if (!current) throw new HttpError(409, 'Add your website first.', 'NO_BUSINESS')
      const website = body.website ? websiteFrom(body.website) : current.website
      if (!website) throw new HttpError(400, 'Enter your website’s address.', 'INVALID_WEBSITE')
      const scan = await (dependencies.startScan || startScan)({ db, user, website, origin })
      return { business: await call(db, 'my_business', { p_user }), scan }
    }
    case 'scanStatus': return { scan: await call(db, 'latest_scan', { p_user }) }
    case 'listFaqs': return { faqs: await call(db, 'list_faqs', { p_user }) }
    case 'saveFaq': {
      const isNew = !body.id
      const question = text(body.question, { max: 200, min: 3, field: 'question' })
      const answer = text(body.answer, { max: 1500, min: 1, field: 'answer' })
      if (isNew && (!question || !answer)) throw new HttpError(400, 'Add a question and its answer.', 'INVALID')
      if (body.status !== undefined && !['draft', 'approved'].includes(body.status)) throw new HttpError(400, 'That change isn’t available.', 'INVALID')
      if (body.featured !== undefined && typeof body.featured !== 'boolean') throw new HttpError(400, 'That change isn’t available.', 'INVALID')
      const faq = await call(db, 'save_faq', {
        p_user, p_id: isNew ? null : id(body.id), p_question: question, p_answer: answer, p_variants: variantsFrom(body.variants),
        p_status: body.status ?? null, p_featured: body.featured ?? null, p_source: body.fromEnquiry ? 'enquiry' : 'owner',
      })
      return { faq }
    }
    case 'deleteFaq': return { deleted: await call(db, 'delete_faq', { p_user, p_id: id(body.id) }) }
    case 'approveAll': return { approved: await call(db, 'approve_all', { p_user }), faqs: await call(db, 'list_faqs', { p_user }) }
    case 'updateBusiness': {
      if (body.character !== undefined && !CHARACTER_KEYS.includes(body.character)) throw new HttpError(400, 'Choose one of the looks on the list.', 'INVALID')
      const notifyEmail = text(body.notifyEmail, { max: 254, field: 'email address' })
      if (notifyEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(notifyEmail)) throw new HttpError(400, 'Enter an email address, like you@yourbusiness.com.au', 'INVALID')
      // Who signs off the answers: a name, or an empty string to take it off.
      const signedBy = text(body.signedBy, { max: 40, field: 'name' })
      let business = await call(db, 'update_business', {
        p_user, p_name: text(body.name, { max: 120, min: 1, field: 'business name' }), p_notify_email: notifyEmail,
        p_character: body.character ?? null, p_greeting: text(body.greeting, { max: 200, min: 1, field: 'greeting' }),
      })
      if (signedBy !== null) business = await call(db, 'set_signed_by', { p_user, p_signed_by: signedBy })
      return { business }
    }
    case 'listEnquiries': {
      const status = body.status ?? 'new'
      if (!['new', 'done'].includes(status)) throw new HttpError(400, 'Choose new or done questions.', 'INVALID')
      const cursor = body.cursor
      if (cursor != null && (typeof cursor !== 'object' || Array.isArray(cursor) || typeof cursor.createdAt !== 'string'
        || !Number.isFinite(Date.parse(cursor.createdAt)))) throw new HttpError(400, 'Refresh the questions and try again.', 'INVALID')
      return call(db, 'enquiries_page', { p_user, p_status: status, p_limit: 50,
        p_before: cursor?.createdAt ?? null, p_before_id: cursor ? id(cursor.id) : null })
    }
    case 'setEnquiry': {
      if (!['new', 'done'].includes(body.status)) throw new HttpError(400, 'That change isn’t available.', 'INVALID')
      return { updated: await call(db, 'set_enquiry', { p_user, p_id: id(body.id), p_status: body.status }) }
    }
    case 'deleteEnquiry': return { deleted: await call(db, 'delete_enquiry', { p_user, p_id: id(body.id) }) }
    // "Check my website": the owner asks us to look for the proof now (the
    // chat button on the home page, or the DNS record). Thirty an hour.
    case 'verifyWebsite': {
      const business = await call(db, 'my_business', { p_user })
      if (!business?.website) throw new HttpError(409, 'Add your website first.', 'NO_BUSINESS')
      if (business.websiteVerifiedAt) return { business, verified: true }
      await rateLimit(db, 'verify', user.id, 30, 3600)
      const { method, reason } = await (dependencies.checkWebsite || checkWebsite)({ website: business.website, slug: business.slug, token: business.verificationToken })
      if (!method) return { business, verified: false, reason }
      await call(db, 'mark_website_verified', { p_slug: business.slug, p_website: business.website, p_method: method })
      return { business: await call(db, 'my_business', { p_user }), verified: true }
    }
  }
}
