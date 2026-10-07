import type { Config } from '@netlify/functions'
import { createServiceClient } from './_lib/runtime.mjs'
import { reconcileBillingBatch } from './_lib/billing.mjs'

// Netlify's scheduled endpoint is unavailable through public HTTP. A bounded
// batch repairs missed events; no secrets or customer identifiers are logged.
export default async () => {
  const result = await reconcileBillingBatch({ db: createServiceClient() })
  console.log('Billing reconciliation', result.processed, result.failed)
}

export const config: Config = { schedule: '*/5 * * * *' }

