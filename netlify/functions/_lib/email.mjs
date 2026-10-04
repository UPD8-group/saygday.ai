// Tells the business when a visitor asked something the chat couldn't answer
// and left their email address. The owner replies straight to the visitor:
// Reply-To is the visitor's address. Sent through Resend; without
// RESEND_API_KEY and SAYGDAY_EMAIL_FROM nothing is sent and the question still
// waits in the dashboard.
import { env } from './runtime.mjs'

export function emailConfiguration(read = env) {
  const key = read('RESEND_API_KEY'), from = read('SAYGDAY_EMAIL_FROM')
  const publicUrl = String(read('SAYGDAY_PUBLIC_URL') || 'https://saygday.ai').replace(/\/+$/, '')
  return { configured: Boolean(key && from), key, from, publicUrl }
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const oneLine = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function enquiryEmail({ businessName, question, visitorEmail, publicUrl }) {
  const business = oneLine(businessName, 100) || 'your business'
  const link = `${publicUrl}/app/asked`
  const subject = oneLine(`A customer asked ${business} a question`, 200)
  const text = [
    `Someone on your website asked a question your SayGday chat doesn’t have an answer for yet:`,
    '',
    `“${String(question).trim()}”`,
    '',
    `They’d like a reply at ${visitorEmail}. Reply to this email to answer them directly.`,
    '',
    `Want the chat to answer this next time? Add it as a question in your dashboard: ${link}`,
    '',
    `You’re getting this because ${business} uses SayGday.`,
  ].join('\n')
  const html = `<!doctype html><html lang="en-AU"><body style="margin:0;padding:24px;background:#f6f4ee;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#14211c;line-height:1.55">
<div style="max-width:560px;margin:0 auto;background:#fffefa;border:1px solid #d8dfda;border-radius:16px;padding:26px">
<p style="margin:0 0 14px">Someone on your website asked a question your SayGday chat doesn’t have an answer for yet:</p>
<div style="margin:0 0 16px;padding:14px 16px;background:#eef3ef;border-radius:12px;font-size:17px;white-space:pre-wrap">${escapeHtml(String(question).trim())}</div>
<p style="margin:0 0 14px">They’d like a reply at <a href="mailto:${escapeHtml(visitorEmail)}" style="color:#31584a">${escapeHtml(visitorEmail)}</a>. <strong>Reply to this email</strong> to answer them directly.</p>
<p style="margin:0 0 14px">Want the chat to answer this next time? <a href="${escapeHtml(link)}" style="color:#31584a">Add it as a question in your dashboard</a>.</p>
<p style="margin:18px 0 0;font-size:12px;color:#5d6b64">You’re getting this because ${escapeHtml(business)} uses SayGday.</p>
</div></body></html>`
  return { subject, text, html }
}

export function enquiryNotificationMessage({ enquiry, configuration = emailConfiguration() }) {
  // Queued messages freeze the public sender settings along with their
  // recipient/content. Credentials remain server-only and may rotate.
  const from = Object.hasOwn(enquiry || {}, 'sender') ? enquiry.sender : configuration.from
  const publicUrl = enquiry?.publicUrl || configuration.publicUrl
  const { subject, text, html } = enquiryEmail({ businessName: enquiry.businessName, question: enquiry.question, visitorEmail: enquiry.email, publicUrl })
  return { from, to: [enquiry.notifyEmail], reply_to: enquiry.email, subject, text, html }
}

export async function sendEnquiryNotification({ enquiry, message, configuration = emailConfiguration(), fetchImpl = fetch }) {
  if (!enquiry?.email || !enquiry?.notifyEmail) return { sent: false, retryable: false, code: 'EMAIL_NOT_CONFIGURED' }
  const payload = message || enquiryNotificationMessage({ enquiry, configuration })
  if (!configuration.configured || !payload.from)
    return { sent: false, retryable: false, code: 'EMAIL_NOT_CONFIGURED' }
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${configuration.key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `enquiry-${enquiry.id}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) console.error(`Enquiry email refused: ${response.status}`)
    return { sent: response.ok, retryable: response.status === 429 || response.status >= 500,
      code: response.ok ? null : `EMAIL_HTTP_${response.status}` }
  } catch {
    console.error('Enquiry email could not be sent')
    return { sent: false, retryable: true, code: 'EMAIL_NETWORK' }
  }
}

// Kept for callers that need only provider acceptance, not retry details.
export async function sendEnquiryEmail(options) { return (await sendEnquiryNotification(options)).sent }
