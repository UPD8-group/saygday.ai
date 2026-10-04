import type { Config } from '@netlify/functions'
import { createServiceClient } from './_lib/runtime.mjs'
import { processEnquiryNotifications } from './_lib/enquiry-notifications.mjs'

// Netlify schedules only published deploys; scheduled functions cannot be
// invoked through a public URL. Three concurrent six-second sends fit inside
// the 30-second execution window. Never enqueue historical enquiries here.
export default async () => {
  const results = await processEnquiryNotifications({ db: createServiceClient() })
  console.log('Enquiry notifications processed', results.length)
}

export const config: Config = { schedule: '* * * * *' }
