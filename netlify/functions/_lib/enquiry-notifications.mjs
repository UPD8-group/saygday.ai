import { call } from './runtime.mjs'
import { enquiryNotificationMessage, sendEnquiryNotification } from './email.mjs'

// Work is already durable before this runs. A crash leaves a two-minute
// lease which the scheduler can reclaim using the SAME idempotency key.
export async function processEnquiryNotifications({ db, id = null, send = sendEnquiryNotification }) {
  const jobs = await call(db, 'claim_enquiry_notifications', { p_id: id, p_limit: 3 })
  return Promise.all(jobs.map(async job => {
    const message = job.message || await call(db, 'prepare_enquiry_notification', {
      p_id: job.enquiry.id, p_lease: job.lease, p_message: enquiryNotificationMessage({ enquiry: job.enquiry }),
    })
    if (!message) return { id: job.enquiry.id, notification: 'pending' }
    let outcome
    try {
      const reply = await send({ enquiry: job.enquiry, message })
      outcome = typeof reply === 'boolean' ? { sent: reply, retryable: !reply, code: reply ? null : 'EMAIL_NETWORK' } : reply
    } catch { outcome = { sent: false, retryable: true, code: 'EMAIL_NETWORK' } }
    const notification = await call(db, 'finish_enquiry_notification', {
      p_id: job.enquiry.id, p_lease: job.lease, p_sent: Boolean(outcome?.sent),
      p_retryable: Boolean(outcome?.retryable), p_failure_code: outcome?.code || null,
    })
    return { id: job.enquiry.id, notification: notification || 'pending' }
  }))
}
