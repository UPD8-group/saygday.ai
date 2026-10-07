import { createServiceClient, errorResponse, json } from './_lib/runtime.mjs'
import { stripeWebhook } from './_lib/billing.mjs'

// Preserve the raw bytes. Browser authentication and JSON middleware cannot
// verify Stripe signatures; the signed body is authenticated by the SDK.
export default async (request: Request) => {
  try { return json(200, await stripeWebhook({ request, db: createServiceClient() })) }
  catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/stripe/webhook' }

