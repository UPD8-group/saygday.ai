# Going live

Everything here is a one-off. It takes about fifteen minutes.

## 1. The database (Supabase, Sydney)

Project: `plcowhnsmrgenzsohbrl` (saygday.ai, ap-southeast-2).

1. **Run the migrations.** SQL editor → paste every file in
   `supabase/migrations/`, oldest first, one at a time → Run.
2. **Nothing else to set in Supabase.** SayGday sends its own sign-in email
   (`netlify/functions/sign-in.mts`): Supabase makes the code, and the site
   emails it from `SAYGDAY_EMAIL_FROM` through Resend. Supabase's own email
   templates, SMTP settings and Site URL aren't used, so they can stay as they
   are. The sending domain (`saygday.ai`) must show as **Verified** in Resend →
   Domains, or no sign-in code can be sent.

### If the database is ever lost

It happened on 3 October 2026: two Supabase projects were both called
SayGday, and the live one was deleted by mistake. Everything needed to rebuild
it is in this repo; what is lost is the data (sign-in accounts, businesses set
up since, customers' questions). The rebuild, about half an hour:

1. Supabase → New project in the `oo studio` organisation, region Sydney
   (`ap-southeast-2`). Let it generate the database password.
2. SQL editor → paste every file in `supabase/migrations/`, oldest first, one
   at a time → Run.
3. Netlify → `saygdayai` → Environment variables: set `SAYGDAY_SUPABASE_URL`
   and `VITE_SAYGDAY_SUPABASE_URL` to the new project's URL,
   `VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY` to its `sb_publishable_…` key, and
   `SAYGDAY_SUPABASE_SERVICE_ROLE_KEY` (production context) to its
   `service_role` key.
4. Change the project ref in `netlify.toml` (the `connect-src` of the
   Content-Security-Policy), `.env.example` and this file; merge. The deploy
   picks up the new settings.
5. Sign in once at `/login` (the owner's account is new again), then run
   `node scripts/own-chat-sql.mjs <owner-user-id>` and paste its output into
   the SQL editor: SayGday's own chat answers are back. Then
   `node scripts/own-chat-verify.mjs` and run the one line it prints, which
   switches the G'day button on.

Name projects so they can't be confused: the old platform's project was
`saygdayAI`, the new one `saygday.ai`. Delete nothing until the SQL editor's
project switcher shows the name you mean.

## 2. The website (Netlify)

The live project is `saygdayai`, with `saygday.ai` (and `www`) as its custom
domain on Netlify DNS. Keep it the only project deploying this repo: another
one would serve the pages without these settings.

1. Add new project → Import an existing project → GitHub →
   `UPD8-group/saygday.ai`. Build settings come from `netlify.toml`.
2. Environment variables (Project configuration → Environment variables):

| Name | Value | Secret? |
|---|---|---|
| `SAYGDAY_SUPABASE_URL` | `https://plcowhnsmrgenzsohbrl.supabase.co` | no |
| `SAYGDAY_SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API keys → `service_role` | **yes**, Functions scope only |
| `VITE_SAYGDAY_SUPABASE_URL` | `https://plcowhnsmrgenzsohbrl.supabase.co` | no |
| `VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_28YxFKp9GRM8dahBUAbuGA_F7KIxXmw` | no (it's public by design) |
| `ANTHROPIC_API_KEY` | your Anthropic key (the same one the old site uses) | **yes** |
| `RESEND_API_KEY` | your Resend key (sends sign-in codes and customers' questions) | **yes** |
| `SAYGDAY_EMAIL_FROM` | `SayGday <hello@saygday.ai>` | no |
| `SAYGDAY_PUBLIC_URL` | `https://saygday.ai` | no |

Optional: `SAYGDAY_SCAN_MODEL` (defaults to `claude-opus-5-5`),
`SAYGDAY_SCAN_SECRET` (defaults to a secret derived from the service key) and
`SAYGDAY_RATE_LIMIT_SECRET` (scrambles the addresses spam limits count; also
derived from the service key by default, and changing it only restarts the
day's counts).

3. Deploy. The website is at `/`; sign in at `/login` with your email and
   scan a website.

## 3. Moving saygday.ai across

The old platform still answers at saygday.ai. When the new one is ready:
Netlify → the new project → Domain management → add `saygday.ai`, then remove
it from the old project. Clients' existing chat code points at the old
platform, so each client adds the new line of code from their dashboard.

## What it costs to run

- **Visitors' questions:** nothing. No AI is involved.
- **A website scan:** one Claude call, roughly A$0.25 to A$0.45. Each business
  can scan at most six times a day.
- **Email:** Resend's free tier covers 3,000 emails a month.
