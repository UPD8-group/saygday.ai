export const cleanEmailCode = value => String(value || '').replace(/\D/g, '').slice(0, 10)

export function friendlyAuthError(error) {
  const details = `${error?.code || ''} ${error?.message || ''}`
  if (/expired|invalid.*token|otp_expired/i.test(details)) return 'That code has expired or isn’t quite right. Use the latest email, or request a new code below.'
  if (error?.status === 429 || /rate.limit|over_email_send_rate_limit/i.test(details)) return 'A code was requested recently. Wait a minute, then try again. Any code already in your inbox can still be entered.'
  if (error?.code === 'REQUEST_TIMEOUT' || /taking longer than expected/i.test(details)) return 'Sign-in is taking longer than expected. If your workspace doesn’t open, check your connection and try the code again.'
  if (/email.*invalid|invalid.*email|email_address_invalid/i.test(details)) return 'Check the email address for a typo, then try again.'
  if (error?.status === 0 || /network|fetch/i.test(details)) return 'We couldn’t reach sign-in. Check your connection and try again.'
  return 'We couldn’t complete sign-in. Try again shortly. If this continues, use the help link below.'
}
