# Going live

The application setup is below. Stripe billing has a separate staged rollout
in [billing.md](billing.md), including one trial-start decision before activation.

## 1. The database (Supabase, Sydney)

Project: `plcowhnsmrgenzsohbrl` (saygday.ai, ap-southeast-2).

1. **Run pending migrations in filename order.** They are in
   `supabase/migrations/`. Check the project's applied migration history first;
   do not rerun migrations already applied. The Stripe migration
   `20261004051312_stripe_billing.sql` is deliberately disabled on arrival:
   applying it does not activate billing or expire existing businesses.
   Its generated timestamp precedes the rescan migration already in this
   repository; on an existing database apply only the pending billing file,
   as explained in the billing runbook, without replaying applied migrations.
2. **Nothing else to set in Supabase.** SayGday sends its own sign-in email
   (`netlify/functions/sign-in.mts`): Supabase makes the code, and the site
   emails it from `SAYGDAY_EMAIL_FROM` through Resend. Supabase's own email
   templates, SMTP settings and Site URL aren't used, so they can stay as they
   are. The sending domain (`saygday.ai`) must show as **Verified** in Resend →
   Domains, or no sign-in code can be sent.

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

## Stripe billing: configure before activating

Follow [the billing runbook](billing.md) before offering paid Checkout.
The plan stays **A$30/month AUD with 14 free days and no card to start**.
Public answers still come exclusively from the business's approved answers.

Add these environment variables in **Functions scope only**, with separate
test and production contexts. Do not use `VITE_` for any Stripe setting.

| Name | Value | Secret? |
|---|---|---|
| `SAYGDAY_STRIPE_MODE` | `test` for isolated tests; `live` for production | no |
| `SAYGDAY_STRIPE_SECRET_KEY` | Matching Stripe secret API key | **yes** |
| `SAYGDAY_STRIPE_PRICE_ID` | Price for `aud`, `3000` cents, every one month | no, server-owned |
| `SAYGDAY_STRIPE_WEBHOOK_SECRET` | This environment's webhook signing secret (`whsec_…`) | **yes** |
| `SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated portal configuration (`bpc_…`) | no, server-owned |

`SAYGDAY_PUBLIC_URL` must be the canonical HTTPS origin, without credentials,
port, path, query or fragment. It supplies fixed Checkout/portal return URLs;
the request Host header and browser input are never used for redirects.

The database starts with `billing_settings.enabled = false` and no trial-start
policy. Existing service continues while it is disabled. Configuration alone
does not enable charging or decide when the free period starts. The runbook
contains the exact activation procedure, webhook event list, reconciliation
limits, smoke checks and paid-subscription rollback considerations. Missing
Stripe configuration after activation disables upgrades; it does not grant
unlimited service.

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
