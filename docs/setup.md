# Going live

Everything here is a one-off. It takes about fifteen minutes.

## 1. The database (Supabase, Sydney)

Project: `eatczhzhhygfxjafnyct` (saygday.ai, ap-southeast-2).

1. **Run the migration.** SQL editor → paste
   `supabase/migrations/20261002100000_saygday.sql` → Run.
2. **Sign-in settings.** Authentication → URL Configuration:
   - Site URL: `https://saygday.ai` (or the Netlify address until the domain moves)
   - Redirect URLs: add `https://saygday.ai/login` and `https://*.netlify.app/login`
3. **The sign-in email.** Authentication → Emails → Templates. Paste
   `supabase/templates/sign-in.html` into **both** "Magic Link" and
   "Confirm signup". Subject for both: `{{ .Token }} is your SayGday sign-in code`.
   A new address gets "Confirm signup", a returning one gets "Magic Link", so
   both must show the code.
4. **Send email from your own address.** Authentication → Emails → SMTP
   settings: turn on custom SMTP with your Resend details (host
   `smtp.resend.com`, port 465, user `resend`, password: a Resend API key,
   sender `hello@saygday.ai`). Without this, Supabase sends only a few sign-in
   emails an hour.

## 2. The website (Netlify)

1. Add new project → Import an existing project → GitHub →
   `UPD8-group/saygday.ai`. Build settings come from `netlify.toml`.
2. Environment variables (Project configuration → Environment variables):

| Name | Value | Secret? |
|---|---|---|
| `SAYGDAY_SUPABASE_URL` | `https://eatczhzhhygfxjafnyct.supabase.co` | no |
| `SAYGDAY_SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API keys → `service_role` | **yes**, Functions scope only |
| `VITE_SAYGDAY_SUPABASE_URL` | `https://eatczhzhhygfxjafnyct.supabase.co` | no |
| `VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_IKV3HjbxWW9aE1oE3Z4_hQ_uv_PAzzb` | no (it's public by design) |
| `ANTHROPIC_API_KEY` | your Anthropic key (the same one the old site uses) | **yes** |
| `RESEND_API_KEY` | your Resend key | **yes** |
| `SAYGDAY_EMAIL_FROM` | `SayGday <hello@saygday.ai>` | no |
| `SAYGDAY_PUBLIC_URL` | `https://saygday.ai` | no |

Optional: `SAYGDAY_SCAN_MODEL` (defaults to `claude-opus-5-5`) and
`SAYGDAY_SCAN_SECRET` (defaults to a secret derived from the service key).

3. Deploy. Then sign in at `/login` with your email and scan a website.

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
