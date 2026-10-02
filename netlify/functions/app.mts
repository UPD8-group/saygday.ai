// POST /api/app: the business owner's dashboard (netlify/functions/_lib/owner.mjs).
import { createServiceClient, errorResponse, json, readJson, HttpError } from './_lib/runtime.mjs'
import { ownerAction } from './_lib/owner.mjs'

export default async (request: Request) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this request.', 'METHOD_NOT_ALLOWED')
    const body = await readJson(request)
    const origin = new URL(request.url).origin
    return json(200, await ownerAction({ request, db: createServiceClient(), body, origin }))
  } catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/app' }
