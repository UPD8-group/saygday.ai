import { createServiceClient, errorResponse, json, readJson, HttpError } from './_lib/runtime.mjs'
import { integrationAction } from './_lib/integrations.mjs'

export default async (request: Request, context: { ip: string }) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this request.', 'METHOD_NOT_ALLOWED')
    return json(200, await integrationAction({ request, db: createServiceClient(), body: await readJson(request), ip: context.ip }))
  } catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/integrations' }
