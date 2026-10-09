import type { Config } from '@netlify/functions'
import { createServiceClient } from './_lib/runtime.mjs'
import { processStudioNotifications } from './_lib/studio-notifications.mjs'

// Runs only on the published site, not via a public HTTP endpoint. The queue
// stores jobs before this runs; three bounded sends fit the scheduled window.
export default async () => {
  const results = await processStudioNotifications({ db:createServiceClient() })
  console.log('Studio notifications processed', results.map(result => result.status))
}

export const config: Config = { schedule:'* * * * *' }
