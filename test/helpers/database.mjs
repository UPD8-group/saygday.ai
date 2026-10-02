import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

// The real migrations, in a real Postgres (PGlite), with just enough of
// Supabase around them: the three roles and an auth.users table.
export async function database() {
  const pg = new PGlite()
  await pg.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
  `)
  const folder = new URL('../../supabase/migrations/', import.meta.url)
  for (const name of (await readdir(folder)).filter(file => file.endsWith('.sql')).sort())
    await pg.exec(await readFile(new URL(name, folder), 'utf8'))
  return pg
}

export async function user(pg, email = `${randomUUID().slice(0, 8)}@example.com`) {
  const id = randomUUID()
  await pg.query('insert into auth.users(id, email) values ($1, $2)', [id, email])
  return { id, email, email_confirmed_at: new Date().toISOString() }
}

// supabase-js's db.rpc(name, args) against PGlite: named arguments, the way
// PostgREST calls a function, and its { data, error } reply.
const asParam = value => Array.isArray(value) && value.every(item => typeof item === 'string') ? value
  : value !== null && typeof value === 'object' ? JSON.stringify(value) : value
export function rpcClient(pg, { user: signedIn = null } = {}) {
  const calls = []
  return {
    calls,
    auth: { getUser: async () => (signedIn ? { data: { user: signedIn }, error: null } : { data: { user: null }, error: { message: 'invalid' } }) },
    async rpc(name, args = {}) {
      calls.push({ name, args })
      const keys = Object.keys(args).filter(key => args[key] !== undefined)
      const sql = `select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as result`
      try {
        const result = await pg.query(sql, keys.map(key => asParam(args[key])))
        return { data: result.rows[0].result, error: null }
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } }
      }
    },
  }
}
