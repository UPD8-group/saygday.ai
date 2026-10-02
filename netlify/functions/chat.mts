// /api/chat: the chat on a business's website (netlify/functions/_lib/visitor.mjs).
// GET hands out the business's approved answers (public, short-cached), but
// only on its verified website: the button's request carries that page's
// Origin, and the chat window passes ?site= for the page it sits in. The
// cache keeps a separate copy per Origin. POST counts a read answer or passes
// on a question the chat couldn't answer.
import type { Context } from '@netlify/functions'
import { createServiceClient, errorResponse, json, readJson, HttpError } from './_lib/runtime.mjs'
import { visitorAction, widgetFor } from './_lib/visitor.mjs'

const PUBLIC = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30, stale-while-revalidate=300', Vary: 'Origin', 'Netlify-Vary': 'header=Origin' }

export default async (request: Request, context: Context) => {
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } })
    const db = createServiceClient()
    if (request.method === 'GET') {
      const url = new URL(request.url)
      // The chat window's own request comes from this site, with no Origin
      // (or this site's); a button on a business's page sends that page's.
      const origin = request.headers.get('origin')
      const widget = await widgetFor({ db, slug: url.searchParams.get('business'), seen: url.searchParams.get('seen') === '1',
        origin: origin && origin !== url.origin ? origin : null, site: url.searchParams.get('site') })
      return json(200, widget, PUBLIC)
    }
    if (request.method !== 'POST') throw new HttpError(405, 'That request isn’t available.', 'METHOD_NOT_ALLOWED')
    const body = await readJson(request, 8192)
    return json(200, await visitorAction({ db, body, ip: context.ip }))
  } catch (error) { return errorResponse(error) }
}

export const config = { path: '/api/chat' }
