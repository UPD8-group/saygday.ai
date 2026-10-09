import { call } from './runtime.mjs'
import { emailConfiguration } from './email.mjs'

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
const singleLine = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120)
const labels = { new: 'New', in_progress: 'In progress', waiting: 'Waiting on you', done: 'Done' }

export function studioNotificationMessage(job, configuration = emailConfiguration()) {
  const business = singleLine(job.payload?.business) || 'Your client space'
  const copy = {
    new_request: ['A new job for the studio', 'A client has sent a new request. Open the dashboard to see what they need.'],
    client_reply: ['A client has replied', 'There’s a new message on a client request. Open the conversation to pick up where you left off.'],
    studio_reply: ['A reply from oo.studio', 'We’ve replied to your request. Open your client space to read it and send us a message.'],
    status: ['Your request has an update', `Your request is now marked “${labels[job.payload?.status] || 'Updated'}”. Open your client space for the latest.`],
  }[job.kind]
  if (!copy || !job.email) throw new Error('INVALID_NOTIFICATION')
  const address = String(configuration.from || '').match(/<([^<>]+)>/)?.[1] || String(configuration.from || '').trim()
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(address)) throw new Error('INVALID_SENDER')
  const [heading, description] = copy
  const link = 'https://oo.studio/dashboard/'
  const footer = 'Please reply in the dashboard so everything stays with your request. Replies to this email aren’t added to your conversation.'
  return {
    from: `oo.studio <${address}>`, to: [job.email], reply_to: 'hello@oo.studio',
    subject: `${heading} — ${business}`,
    text: `${heading}\n\n${business}\n\n${description}\n\nOpen your dashboard: ${link}\n\n${footer}\n\nThis is an update from your oo.studio client space.`,
    html: `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(heading)}</title></head><body style="margin:0;padding:24px;background:#f6f3e9;color:#322e35;font-family:Arial,sans-serif;line-height:1.6"><div style="max-width:560px;margin:0 auto;border:1px solid #322e35;border-radius:20px;overflow:hidden;background:#fffdf8"><div style="padding:22px 28px;background:#c7b7f1;border-bottom:1px solid #322e35;font-size:28px;letter-spacing:-1px">oo.studio</div><div style="padding:28px"><p style="font-size:12px;letter-spacing:1px;text-transform:uppercase">${escapeHtml(business)}</p><h1 style="font-size:28px;line-height:1.2;margin:12px 0 20px">${escapeHtml(heading)}</h1><p>${escapeHtml(description)}</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;background:#322e35;color:#fffdf8;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Open your dashboard ↗</a></p><p style="font-size:13px;color:#625a66">${escapeHtml(footer)}</p><p style="font-size:12px;color:#625a66">This is an update from your oo.studio client space.</p></div></div></body></html>`,
  }
}

export async function sendStudioNotification({ job, message, configuration = emailConfiguration(), fetchImpl = fetch }) {
  if (!configuration.configured) return { sent:false, retryable:true, code:'EMAIL_NOT_CONFIGURED' }
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method:'POST', headers:{ Authorization:`Bearer ${configuration.key}`, 'Content-Type':'application/json', 'Idempotency-Key':`oo-notification-${job.id}` },
      body:JSON.stringify(message), signal:AbortSignal.timeout(6000),
    })
    if (!response.ok) return { sent:false, retryable:response.status === 429 || response.status >= 500, code:`EMAIL_HTTP_${response.status}` }
    const result = await response.json()
    if (!result?.id) return { sent:false, retryable:true, code:'EMAIL_RESPONSE' }
    return { sent:true, retryable:false, id:result.id }
  } catch { return { sent:false, retryable:true, code:'EMAIL_NETWORK' } }
}

export async function processStudioNotifications({ db, configuration = emailConfiguration(), send = sendStudioNotification }) {
  if (!configuration.configured) throw new Error('Studio notification email is not configured')
  const jobs = await call(db, 'oo_claim_notifications', { p_limit:3 })
  return Promise.all(jobs.map(async job => {
    // Always prepare, including retries: this rechecks current recipient access.
    const message = await call(db, 'oo_prepare_notification', {
      p_id:job.id, p_lease:job.lease, p_message:job.message || studioNotificationMessage(job, configuration),
    })
    if (!message) return { id:job.id, status:'cancelled' }
    let outcome
    try { outcome = await send({ job, message, configuration }) }
    catch { outcome = { sent:false, retryable:true, code:'EMAIL_NETWORK' } }
    const status = await call(db, 'oo_finish_notification', {
      p_id:job.id, p_lease:job.lease, p_sent:Boolean(outcome?.sent),
      p_retryable:Boolean(outcome?.retryable), p_code:outcome?.code || null, p_provider_id:outcome?.id || null,
    })
    return { id:job.id, status:status || 'pending' }
  }))
}
