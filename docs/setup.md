# Going live

The application setup is below. See [billing.md](billing.md) for the current
card-before-activation policy (owner, 8 October 2026): free building and
preview, then verify the website and add a card for 14 live days free.

## 1. The database (Supabase, Sydney)

Project: `plcowhnsmrgenzsohbrl` (saygday.ai, ap-southeast-2).

1. **Run the migrations.** SQL editor → paste each file in
   `supabase/migrations/`, oldest first, → Run. A later change is a later
   file: 20261004130000_many_businesses_per_owner.sql (one sign-in, many
   businesses) must be run on a project set up before 4 October 2026.
   For simple button colours, also run `20261004132908_simple_button_colour.sql` before deploying the updated dashboard and functions. Existing buttons keep SayGday green until their owner saves a colour.
   For the admin page (5 October 2026), run `20261005100000_admin_dashboard.sql`. It only adds: each business's plan,
   day-by-day counts of answers read, and the admin page's summaries. SayGday's own `saygday` business starts as
   "Ours / test", so it counts in no total.

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
| `SAYGDAY_ADMIN_PASSWORD` | a long passphrase of your own (at least 12 characters) for the admin page, `/admin` | **yes**, Functions scope only |

Optional: `SAYGDAY_SCAN_MODEL` (defaults to `claude-opus-5-5`),
`SAYGDAY_SCAN_SECRET` (defaults to a secret derived from the service key) and
`SAYGDAY_RATE_LIMIT_SECRET` (scrambles the addresses spam limits count; also
derived from the service key by default, and changing it only restarts the
day's counts).

3. Deploy. The website is at `/`; sign in at `/login` with your email and
   scan a website.

## 3. The admin page

`https://saygday.ai/admin` shows every sign-in and business, where each business
is in its free 14 days, and the numbers an investor asks for. It opens with
`SAYGDAY_ADMIN_PASSWORD`; without it (or with one shorter than 12 characters) the
page says it's switched off. Netlify uses a new or changed variable from the
next deploy, so deploy again after setting it. Changing the password signs
everyone out. It takes at most ten tries an hour from one connection (fifty
in all); past that, signing in waits until the hour is up.

Stripe updates paying and cancelled status automatically after reconciliation. Mark internal businesses **Ours / test** to exclude them from revenue totals. Answers read and chats in use are
counted day by day from the day the migration runs.

## 4. Stripe billing: configure before activating

Follow [the billing runbook](billing.md) before offering paid Checkout.
The plan is **14 live days free, then A$30/month AUD automatically unless cancelled**. Building and preview need no card; public activation requires one.
Public answers still come exclusively from the business's approved answers.

Add these environment variables in **Functions scope only**, with separate
test and production contexts. Do not use `VITE_` for any Stripe setting.

| Name | Value | Secret? |
|---|---|---|
| `SAYGDAY_STRIPE_MODE` | `test` for isolated tests; `live` for production | no |
| `SAYGDAY_STRIPE_SECRET_KEY` | Matching restricted Stripe API key with the required billing permissions | **yes** |
| `SAYGDAY_STRIPE_PUBLISHABLE_KEY` | Matching public `pk_` key; optional for the configured saygday.ai production origin and live price | no, public by design |
| `SAYGDAY_STRIPE_PRICE_ID` | Price for `aud`, `3000` cents, every one month | no, server-owned |
| `SAYGDAY_STRIPE_WEBHOOK_SECRET` | This environment's webhook signing secret (`whsec_…`) | **yes** |
| `SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated portal configuration (`bpc_…`) | no, server-owned |

`SAYGDAY_PUBLIC_URL` must be the canonical HTTPS origin, without credentials,
port, path, query or fragment. It supplies fixed Checkout/portal return URLs;
the request Host header and browser input are never used for redirects.

After versioned migrations, apply supabase/billing-upgrade.sql, then
supabase/billing-card-activation.sql. Production already applied the original
billing migration with compatibility as 20261008073543; do not replay it.
Deploy compatible code before the card-activation script. Billing is enabled
in production. New trials require verified ownership plus a confirmed
card-backed Stripe subscription; already-started trials keep their dates.
Configuration alone does not create a subscription or charge anyone. The runbook
contains the exact activation procedure, webhook event list, reconciliation
limits, smoke checks and paid-subscription rollback considerations. Missing
Stripe configuration after activation disables upgrades; it does not grant
unlimited service.

## Existing installations

The domain already points to the `saygdayai` Netlify project. Clients still
using the earlier platform's embed must add the current line of code from
their dashboard. Do not move the domain or create a duplicate Netlify project.

## What it costs to run

- **Visitors' questions:** nothing. No AI is involved.
- **A website scan:** one Claude call, roughly A$0.25 to A$0.45. Each business
  can scan at most six times a day.
- **Email:** Resend's free tier covers 3,000 emails a month.

