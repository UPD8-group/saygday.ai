// POST /api/admin: SayGday's own admin page (netlify/functions/_lib/admin.mjs).
import type { Context } from '@netlify/functions'
import { createServiceClient, errorResponse, json, readJson, HttpError } from './_lib/runtime.mjs'
import { adminAction } from './_lib/admin.mjs'

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this request.', 'METHOD_NOT_ALLOWED')
    const body = await readJson(request, 4096)
    const { result, cookie } = await adminAction({ request, db: createServiceClient(), body, ip: context.ip })
    return json(200, result, cookie ? { 'Set-Cookie': cookie } : {})
  } catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/admin' }
