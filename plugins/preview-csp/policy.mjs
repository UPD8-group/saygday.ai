const PRODUCTION_ORIGIN = 'https://plcowhnsmrgenzsohbrl.supabase.co'
const APP_PATHS = ['/app', '/app/*', '/app.html']
const STRIPE_SOURCES = {
  'script-src': 'https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com',
  'img-src': 'https://*.stripe.com https://*.link.com',
  'connect-src': 'https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com',
  'frame-src': 'https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com https://link.com https://*.link.com',
}

function policyAt(netlifyConfig, path) {
  const headers = netlifyConfig.headers?.filter(header => header.for === path) || []
  const values = headers[0]?.values
  const keys = Object.keys(values || {}).filter(key => key.toLowerCase() === 'content-security-policy')
  if (headers.length !== 1 || keys.length !== 1 || typeof values[keys[0]] !== 'string') {
    throw new Error(`Deploy preview requires exactly one Content-Security-Policy header for ${path}.`)
  }
  const directives = values[keys[0]].split(';').map(value => value.trim()).filter(Boolean)
  const names = directives.map(value => value.split(/\s/)[0])
  if (new Set(names).size !== names.length) {
    throw new Error(`Deploy preview found duplicate CSP directives for ${path}; review them before deploying.`)
  }
  return { values, key: keys[0], directives }
}

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

  const global = policyAt(netlifyConfig, '/*')
  const connections = global.directives.filter(value => /^connect-src(?:\s|$)/.test(value))
  if (connections.length !== 1 || connections[0] !== `connect-src 'self' ${PRODUCTION_ORIGIN}`) {
    throw new Error('Deploy preview found an unexpected global connect-src policy; review it before deploying.')
  }

  const expectedApp = global.directives.map(value => {
    const sources = STRIPE_SOURCES[value.split(/\s/)[0]]
    return sources ? `${value} ${sources}` : value
  })
  const apps = APP_PATHS.map(path => {
    const policy = policyAt(netlifyConfig, path)
    if (policy.directives.join(';') !== expectedApp.join(';')) {
      throw new Error(`Deploy preview found an unexpected app CSP for ${path}; review it before deploying.`)
    }
    return policy
  })

  // Validate every policy before changing any of them. A duplicate app rule,
  // broad wildcard or extra connection must never leave a half-isolated build.
  // Preserve every other directive and header, including the embedded chat's
  // self-only connections and its independent framing policy.
  for (const { values, key } of [global, ...apps]) {
    values[key] = values[key].replace(PRODUCTION_ORIGIN, origin)
  }
}

