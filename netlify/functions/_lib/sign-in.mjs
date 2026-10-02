// The sign-in email. SayGday sends it itself, from the SayGday address through
// Resend, instead of using Supabase's built-in emails: those come from
// "Supabase Auth", need two dashboard templates to carry the code, and link to
// the project's Site URL. Supabase still makes and checks the code: the
// server asks for it with auth.admin.generateLink (which sends nothing), this
// file emails it, and the browser checks it with verifyOtp (type 'email'), as
// before. A new address gets an account the first time, as before.
import { HttpError, rateLimit } from './runtime.mjs'
import { emailConfiguration } from './email.mjs'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const UNAVAILABLE = 'We couldn’t send your code just now. Please try again in a minute.'

export function signInEmail({ code }) {
  const digits = String(code).replace(/\D/g, '')
  const subject = `${digits} is your SayGday sign-in code`
  const text = [
    `Your SayGday sign-in code is ${digits}`,
    '',
    'Enter it on the SayGday sign-in screen to open your dashboard.',
    '',
    'Keep this code to yourself. We’ll never ask you to send it back to us.',
    '',
    'Didn’t request this email? You can safely ignore it. If your code has expired, request a new one from the SayGday sign-in screen.',
    '',
    'SayGday.ai · Made in Canberra for Australian small business.',
  ].join('\n')
  const html = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <title>Your SayGday sign-in code</title>
</head>
<body style="margin:0;padding:0;background:#fffefa;color:#14211c;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;text-size-adjust:100%">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fffefa">
    <tr>
      <td align="center" style="padding:38px 16px 44px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;margin:0 auto">
          <tr>
            <td style="padding:0 0 34px">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="middle" style="padding-right:10px">
                    <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border:2px solid #31584a;border-radius:50%;color:#31584a;font-size:8px;font-weight:700">SG</span>
                  </td>
                  <td valign="middle" style="font-size:24px;line-height:1;font-weight:700;letter-spacing:-1px;color:#14211c">
                    SayGday<span style="font-weight:400;color:#617069">.ai</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#31584a;border-radius:24px;padding:38px 34px 36px;color:#ffffff">
              <p style="margin:0 0 13px;color:#c5d8cf;font-size:10px;line-height:1.4;font-weight:700;letter-spacing:1.6px;text-transform:uppercase">YOUR DASHBOARD</p>
              <h1 style="margin:0;color:#ffffff;font-size:42px;line-height:1.02;font-weight:600;letter-spacing:-1.8px">G’day. Let’s get you in.</h1>
              <p style="margin:20px 0 0;color:#dce7e1;font-size:16px;line-height:1.65">Enter the code below on the SayGday sign-in screen to open your SayGday dashboard.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 0 0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;border:1px solid #d8dfda;border-radius:20px">
                <tr>
                  <td style="padding:30px 28px 26px">
                    <p style="margin:0 0 12px;color:#31584a;font-size:10px;line-height:1.4;font-weight:700;letter-spacing:1.7px;text-transform:uppercase">YOUR SIGN-IN CODE</p>
                    <p style="margin:0;color:#14211c;font-size:38px;line-height:1.15;font-weight:600;letter-spacing:7px;white-space:nowrap">${digits}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 2px 0">
              <p style="margin:0;color:#14211c;font-size:15px;line-height:1.65;font-weight:600">Keep this code to yourself.</p>
              <p style="margin:5px 0 0;color:#617069;font-size:14px;line-height:1.7">We’ll never ask you to send your sign-in code back to us.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 2px 0">
              <div style="height:1px;line-height:1px;background:#d8dfda">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:25px 2px 0">
              <p style="margin:0 0 6px;color:#14211c;font-size:14px;line-height:1.6;font-weight:600">Didn’t request this email?</p>
              <p style="margin:0;color:#617069;font-size:13px;line-height:1.7">You can safely ignore it. If your code has expired, request a new one from the SayGday sign-in screen.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 2px 0">
              <p style="margin:0;color:#31584a;font-size:14px;line-height:1.5;font-weight:700">A little help. A lot more time.</p>
              <p style="margin:7px 0 0;color:#7a8580;font-size:11px;line-height:1.6">SayGday.ai · Made in Canberra for Australian small business.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  return { subject, text, html }
}

export async function sendSignInCode({ db, body, ip, configuration = emailConfiguration(), fetchImpl = fetch }) {
  if (!configuration.configured) throw new HttpError(503, 'SayGday is still being connected. Please try again soon.', 'NOT_CONFIGURED')
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, 'Enter your email address, like you@yourbusiness.com.au', 'INVALID_EMAIL')

  // One code a minute and six an hour for an address; twenty an hour from one
  // connection. Nobody can use the form to flood someone's inbox.
  await rateLimit(db, `sign-in:ip:${ip || 'unknown'}`, 20, 3600)
  await rateLimit(db, `sign-in:email-minute:${email}`, 1, 55)
  await rateLimit(db, `sign-in:email:${email}`, 6, 3600)

  let link
  try { link = await db.auth.admin.generateLink({ type: 'magiclink', email }) } catch { throw new HttpError(503, UNAVAILABLE, 'SIGN_IN_UNAVAILABLE') }
  if (link?.error) {
    if (link.error.status === 429) throw new HttpError(429, 'A code was sent a moment ago. Wait a minute, then try again.', 'RATE_LIMITED')
    if (link.error.status === 400 || link.error.status === 422) throw new HttpError(400, 'Check the email address for a typo, then try again.', 'INVALID_EMAIL')
    console.error(`Sign-in code refused: ${link.error.status || 'no status'} ${link.error.code || ''}`)
    throw new HttpError(503, UNAVAILABLE, 'SIGN_IN_UNAVAILABLE')
  }
  const code = link?.data?.properties?.email_otp
  if (!/^\d{6,10}$/.test(String(code || ''))) throw new HttpError(503, UNAVAILABLE, 'SIGN_IN_UNAVAILABLE')

  const { subject, text, html } = signInEmail({ code })
  const hashed = String(link.data.properties.hashed_token || '').replace(/[^a-z0-9]/gi, '').slice(0, 120)
  let response
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${configuration.key}`, 'Content-Type': 'application/json', ...(hashed ? { 'Idempotency-Key': `sign-in-${hashed}` } : {}) },
      body: JSON.stringify({ from: configuration.from, to: [email], subject, text, html }),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    console.error('Sign-in email could not be sent')
    throw new HttpError(503, UNAVAILABLE, 'EMAIL_UNAVAILABLE')
  }
  if (!response.ok) {
    const reply = await response.json().catch(() => null)
    console.error(`Sign-in email refused: ${response.status} ${reply?.name || ''}`)
    throw new HttpError(503, UNAVAILABLE, 'EMAIL_UNAVAILABLE')
  }
  return { sent: true }
}
