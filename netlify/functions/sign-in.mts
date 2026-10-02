// POST /api/sign-in: emails a sign-in code (netlify/functions/_lib/sign-in.mjs).
import type { Context } from '@netlify/functions'
import { createServiceClient, errorResponse, json, readJson, HttpError } from './_lib/runtime.mjs'
import { sendSignInCode } from './_lib/sign-in.mjs'

export default async (request: Request, context: Context) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Use POST for this request.', 'METHOD_NOT_ALLOWED')
    const body = await readJson(request, 2048)
    return json(200, await sendSignInCode({ db: createServiceClient(), body, ip: context.ip }))
  } catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/sign-in' }
