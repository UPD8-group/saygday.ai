import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { onPreBuild } from '../plugins/preview-csp/index.js'
import { applyPreviewCsp } from '../plugins/preview-csp/policy.mjs'

const configPath = new URL('../netlify.toml', import.meta.url)
const source = await readFile(configPath, 'utf8')
const production = 'https://plcowhnsmrgenzsohbrl.supabase.co'
const preview = 'https://yupjxevdhcwwrgpdlaix.supabase.co'
const env = { CONTEXT: 'deploy-preview', VITE_SAYGDAY_SUPABASE_URL: preview }

// Exercise the checked-in headers, not a second copy of their policies. This
// small reader accepts this file's quoted-string header blocks and rejects
// unrecognised header syntax so a config change cannot silently skip coverage.
function config() {
  const headers = source.split(/^\[\[headers\]\]\s*$/m).slice(1).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    const path = lines.shift().match(/^for = (".*")$/)
    assert.ok(path, 'each header rule has its literal path')
    assert.equal(lines.shift(), '[headers.values]')
    const values = Object.fromEntries(lines.map(line => {
      const value = line.match(/^([\w-]+) = (".*")$/)
      assert.ok(value, 'header values remain literal strings')
      return [value[1], JSON.parse(value[2])]
    }))
    return { for: JSON.parse(path[1]), values }
  })
  assert.equal(headers.length, 7, 'all checked-in header rules are exercised')
  return { headers, build: { command: 'npm test && npm run build', publish: 'dist' }, redirects: [{ from: '/app/*', to: '/app.html', status: 200 }] }
}
const globalPolicy = value => value.headers.find(header => header.for === '/*').values['Content-Security-Policy']

test('only deploy previews register the local CSP build plugin', async () => {
  const registrations = [...source.matchAll(/^\[\[(.*?)plugins\]\]\s*\n\s*package = "([^"]+)"/gm)]
  assert.deepEqual(registrations.map(([, context, path]) => [context, path]), [['context.deploy-preview.', './plugins/preview-csp']])
  const manifest = await readFile(new URL('../plugins/preview-csp/manifest.yml', import.meta.url), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('../plugins/preview-csp/package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.trim(), `name: ${pkg.name}`)
  assert.equal(pkg.type, 'module')
})

test('preview permits only its configured Supabase origin and preserves all other source policies', async () => {
  for (const url of [preview, `${preview}/`]) {
    const actual = config()
    const expected = structuredClone(actual)
    const policy = globalPolicy(expected)
    assert.ok(policy.includes(`connect-src 'self' ${production};`))
    expected.headers.find(header => header.for === '/*').values['Content-Security-Policy'] = policy.replace(production, preview)
    applyPreviewCsp(actual, { ...env, VITE_SAYGDAY_SUPABASE_URL: url })
    assert.deepEqual(actual, expected, 'the exact production origin is the only in-memory change')
    assert.equal(globalPolicy(actual).split(';').find(value => value.trim().startsWith('connect-src')).trim(), `connect-src 'self' ${preview}`)
    const chat = actual.headers.find(header => header.for === '/chat.html').values['Content-Security-Policy']
    assert.match(chat, /connect-src 'self'; frame-ancestors \*/)
    assert.ok(!chat.includes('supabase.co'), 'visitor chat never gains a database connection')
  }
  assert.equal(await readFile(configPath, 'utf8'), source, 'the build never rewrites shared source')
})

test('production, branch deploys and local builds keep every header unchanged', () => {
  for (const context of ['production', 'branch-deploy', 'dev', undefined]) {
    for (const url of [preview, production, 'invalid', undefined]) {
      const actual = config()
      const expected = structuredClone(actual)
      applyPreviewCsp(actual, { CONTEXT: context, VITE_SAYGDAY_SUPABASE_URL: url })
      assert.deepEqual(actual, expected, context)
    }
  }
})

test('preview rejects production, missing, ambiguous or unsafe origins without changing headers', () => {
  const invalid = [
    undefined, null, '', production, `${production}/`, 'http://yupjxevdhcwwrgpdlaix.supabase.co',
    `${preview}:443`, `${preview}:8443`, `${preview}/auth`, `${preview}?x=1`, `${preview}#x`,
    `${preview} `, ` ${preview}`, `${preview}\n`, `${preview}; connect-src *`, `${preview}\r\nX-Injected: yes`,
    'https://user:secret@yupjxevdhcwwrgpdlaix.supabase.co', 'https://*.supabase.co',
    `${preview}.evil.example`, 'https://evil.example', 'https://localhost', 'https://short.supabase.co',
    'https://yupjxevdhcwwrgpdlaix.supabase.co\\@evil.example', `${preview} https://evil.example`,
  ]
  for (const url of invalid) {
    const actual = config()
    const before = structuredClone(actual)
    assert.throws(() => applyPreviewCsp(actual, { ...env, VITE_SAYGDAY_SUPABASE_URL: url }), /Deploy preview requires/)
    assert.deepEqual(actual, before, 'failed validation never mutates any policy')
  }
})

test('unexpected or duplicate source policies fail closed without broadening the preview', () => {
  const cases = [
    value => { value.headers = [] },
    value => { value.headers.push(structuredClone(value.headers[0])) },
    value => { delete value.headers[0].values['Content-Security-Policy'] },
    value => { value.headers[0].values['content-security-policy'] = globalPolicy(value) },
    value => { value.headers[0].values['Content-Security-Policy'] = null },
    value => { value.headers[0].values['Content-Security-Policy'] = globalPolicy(value).replace(production, '*') },
    value => { value.headers[0].values['Content-Security-Policy'] += '; connect-src https://other.example' },
    value => { value.headers[0].values['Content-Security-Policy'] = globalPolicy(value).replace(` ${production}`, '') },
  ]
  for (const change of cases) {
    const actual = config()
    change(actual)
    const before = structuredClone(actual)
    assert.throws(() => applyPreviewCsp(actual, env), /Deploy preview (requires|found)/)
    assert.deepEqual(actual, before)
  }
})

test('the Netlify build hook reads public preview configuration and stops unsafe builds', t => {
  const names = ['CONTEXT', 'VITE_SAYGDAY_SUPABASE_URL']
  const previous = names.map(name => process.env[name])
  t.after(() => names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name]
    else process.env[name] = previous[index]
  }))
  process.env.CONTEXT = 'deploy-preview'
  process.env.VITE_SAYGDAY_SUPABASE_URL = preview
  const actual = config()
  const failures = []
  const utils = { build: { failBuild: message => { failures.push(message) } } }
  onPreBuild({ netlifyConfig: actual, utils })
  assert.ok(globalPolicy(actual).includes(preview))
  assert.deepEqual(failures, [])
  process.env.VITE_SAYGDAY_SUPABASE_URL = 'invalid-secret-that-must-not-be-logged'
  onPreBuild({ netlifyConfig: config(), utils })
  assert.equal(failures.length, 1)
  assert.match(failures[0], /VITE_SAYGDAY_SUPABASE_URL/)
  assert.ok(!failures[0].includes('invalid-secret'))
})
