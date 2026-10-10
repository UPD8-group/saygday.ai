import { withDeadline } from './request-lifecycle.js'

export async function integrationRequest(client, action, details = {}) {
  return withDeadline(async signal => {
    const { data, error } = await client.auth.getSession()
    if (error || !data?.session?.access_token) throw new Error('Please sign in again to continue.')
    const response = await fetch('/api/integrations', { method: 'POST', cache: 'no-store', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify({ ...details, action }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'We couldn’t update this connection. Please try again.')
    return result
  }, { timeoutMs: 20000 })
}
