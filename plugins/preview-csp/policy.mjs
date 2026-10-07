const PRODUCTION_ORIGIN = 'https://plcowhnsmrgenzsohbrl.supabase.co'

// Netlify does not scope [[headers]] to deploy contexts. Change its normalized
// in-memory configuration instead of rewriting the shared TOML or _headers.
export function applyPreviewCsp(netlifyConfig, env) {
  if (env.CONTEXT !== 'deploy-preview') return

  const value = env.VITE_SAYGDAY_SUPABASE_URL
  // Accept only one literal project origin (and an optional trailing slash).
  // This rejects credentials, ports, paths, wildcards and header injection.
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(value)) {
    throw new Error('Deploy preview requires VITE_SAYGDAY_SUPABASE_URL to be an HTTPS Supabase project origin.')
  }
  const origin = value.replace(/\/$/, '')
  if (origin === PRODUCTION_ORIGIN) {
    throw new Error('Deploy preview requires an isolated Supabase project, not the production project.')
  }

  const globals = netlifyConfig.headers?.filter(header => header.for === '/*') || []
  const values = globals[0]?.values
  const keys = Object.keys(values || {}).filter(key => key.toLowerCase() === 'content-security-policy')
  if (globals.length !== 1 || keys.length !== 1 || typeof values[keys[0]] !== 'string') {
    throw new Error('Deploy preview requires exactly one global Content-Security-Policy header.')
  }
  const key = keys[0]
  const directives = values[key].split(';')
  const connections = directives.filter(value => /^connect-src(?:\s|$)/.test(value.trim()))
  if (connections.length !== 1 || connections[0].trim() !== `connect-src 'self' ${PRODUCTION_ORIGIN}`) {
    throw new Error('Deploy preview found an unexpected global connect-src policy; review it before deploying.')
  }

  // Preserve every other directive and header, including the embedded chat's
  // self-only connections and its independent framing policy.
  values[key] = directives.map(value => value === connections[0]
    ? value.replace(PRODUCTION_ORIGIN, origin)
    : value).join(';')
}

