// The website scan, run in the background (netlify/functions/_lib/scan.mjs).
// Only a request signed with SAYGDAY_SCAN_SECRET starts one.
import { createServiceClient } from './_lib/runtime.mjs'
import { runScan, scanConfiguration, verifyScanTrigger } from './_lib/scan.mjs'

export default async (request: Request) => {
  if (request.method !== 'POST') return
  let body
  try { body = await request.json() } catch { return }
  const configuration = scanConfiguration()
  if (!verifyScanTrigger(body, configuration.secret)) return
  await runScan({ db: createServiceClient(), scanId: body.scanId, configuration })
}
