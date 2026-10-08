# Stripe billing

## Current integration (8 October 2026)

Billing is per website. Every owner action names the selected business; Stripe return URLs restore that same website. Internal/test businesses retain access and stay out of revenue totals. Stripe reconciliation updates the admin plan history, while the live paying count also checks paid-through dates and sync freshness.

Apply versioned migrations, then supabase/billing-upgrade.sql, then
supabase/billing-card-activation.sql. Production already applied the original
Stripe migration together with the compatibility script under version
20261008073543_stripe_billing_with_multibusiness_compatibility. Do not replay
the original file because its old timestamp is absent from remote history.
Deploy compatible code before the card-activation SQL. That SQL is idempotent.

## Card before public activation (owner decision, 8 October 2026)

Build, scan, approve answers and preview free without a card. Verify website
ownership, then complete Stripe Checkout with a payment method to go live.
The full 14 days start when Stripe confirms the subscription, followed by
**A$30/month AUD automatically unless cancelled**. Opening or abandoning
Checkout starts nothing. Stripe collects the payment method with
payment_method_collection=always and trial_period_days=14. No raw card data
reaches SayGday. Missing-payment-method trial expiry cancels the subscription.

Only a current provider subscription tied to the persisted Checkout key and
business, with a payment method, exact price and 14-day interval, can persist
the trial under the existing atomic lease. Website verification alone cannot
start it. Trial dates remain immutable through resubscription and domain changes.
All public chat entry points stay blocked until entitlement exists. Owner
editing and preview remain available. Visitors still receive approved answers
word for word; billing never changes the chat model.

Already-started trials are grandfathered without changing their dates or
requiring a card until expiry. Their payments begin only if they subscribe;
Checkout preserves their original end date. The original website_verified
policy remains in the database for this legacy cohort, while
require_card_for_new_trials=true governs new accounts. The earlier no-card
policy and sandbox notes are historical, superseded by this owner decision.

Stripe Dashboard > Billing > Subscriptions and emails: the seven-day trial
reminder is enabled, with a Stripe-hosted payment update page and a link to
the customer portal for cancellation. Customers see the price and first
charge date in Checkout and their trial end date in Settings > Billing.

## Stripe account and fixed price

The owner explicitly chose live production validation. Automated regression
tests use local database fixtures and mocked Stripe responses, never real
charges. No completed live payment is claimed until observed. Never connect
a preview to production keys or a production billing database.

Create one active recurring Price with these settings:

| Setting | Required value |
|---|---|
| Currency | `aud` |
| Unit amount | `3000` cents |
| Interval | One month |
| Quantity | Exactly `1` |
| Tax behaviour | Inclusive; the displayed total remains A$30 |
| Coupons / promotion codes | Disabled |
| Adjustable quantities / additional products | Disabled |
| Automatic tax / additional tax rates | Disabled |

The server chooses this Price. Never accept a price ID, amount, currency,
quantity, customer ID, subscription ID or return URL supplied by the browser
as authority. Do not edit the price or portal configuration to add taxes,
discounts or a second plan without implementing and testing that change.

Each Checkout request explicitly sets `managed_payments.enabled=false`.
Some Stripe accounts enable Managed Payments by default; that merchant-of-record
service requires its own tax and localised pricing, which conflicts with this
direct A$30 AUD offer. The per-session opt-out preserves the offer without
changing account-wide settings. See Stripe's
[Managed Payments Checkout documentation](https://docs.stripe.com/payments/managed-payments/update-checkout).

Checkout uses dynamic payment methods from the Stripe Dashboard; it does not
hardcode `payment_method_types`. Configure the methods appropriate for the
business there. Delayed methods do not grant access on Checkout completion:
signed completion, asynchronous success/failure and invoice events always
reconcile the current subscription and its paid invoice. Each saved Checkout
operation also includes an integration label ending in eight random letters;
retries reuse the label and all other original parameters with the same
idempotency key.

Create a dedicated Stripe customer portal configuration. Enable payment
method updates, invoice history and cancellation **at the end of the billing
period**, with cancellation proration set to `none`. Disable plan changes,
quantity changes, customer detail updates, subscription pausing and
cancellation retention discounts. An owner can cancel future renewal while keeping any remaining
paid access. Removing the widget code does not cancel a subscription.

Stripe can represent a portal cancellation with an explicit `cancel_at`
timestamp while `cancel_at_period_end` remains false, including flexible
subscriptions. Reconciliation recognises either form as scheduled cancellation.
Stored access ends at the earlier of the paid item's period end and that
timestamp. A cancellation date never extends paid time or substitutes for a
missing paid period; malformed dates fail closed.

## Configuration and activation

The environment variables are in [.env.example](../.env.example) and
[setup.md](setup.md). All `SAYGDAY_STRIPE_*` variables belong in **Netlify
Functions scope only**. Stripe Checkout is hosted by Stripe, so the browser
needs no Stripe publishable key or Stripe.js. Use the keys and resources from
one Stripe account and mode consistently.

| Variable | Purpose |
|---|---|
| `SAYGDAY_STRIPE_MODE` | Explicit `test` or `live`; must match the API key, events and resources. |
| `SAYGDAY_STRIPE_SECRET_KEY` | Restricted API key with the required permissions; never commit, print or expose through a `VITE_` variable. |
| `SAYGDAY_STRIPE_PRICE_ID` | The exact active monthly AUD 3000-cent Price. |
| `SAYGDAY_STRIPE_WEBHOOK_SECRET` | Signing secret for this endpoint and mode, beginning `whsec_`. |
| `SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID` | Dedicated portal configuration, beginning `bpc_`. |
| `SAYGDAY_PUBLIC_URL` | Canonical HTTPS origin, e.g. `https://saygday.ai`; no path, port, credentials, query or fragment. |

A missing or mismatched setting disables the affected billing operation.
Never “fix” configuration by treating a failed check as paid access. Local
Stripe CLI delivery uses the CLI listener's signing secret; a deployed event
destination uses its own signing secret. Do not swap test/live secrets or
point both modes at the same billing database.

The client uses authenticated owner actions on `POST /api/app`:
`billingStatus`, `billingCheckout` and `billingPortal`. The server derives
the owner from their verified bearer token and looks up the matching business.
Only server-owned customer mappings can select a Stripe account. Checkout
and portal URLs must resolve to the expected Stripe host.

After finishing Stripe configuration and the isolated rollout tests, an
operator can activate billing in the Supabase SQL editor or another trusted
database session. This is deliberately **not** a browser setting. The
activation uses the owner's recorded first-verification policy:

```sql
-- Run only after Stripe configuration and rollout checks pass.
update public.billing_settings
set trial_start_policy = 'website_verified', enabled = true
where singleton = true
returning enabled, trial_start_policy, activated_at;
```

The database records `activated_at` itself. Policy and activation time become
immutable at first activation. Disabling and re-enabling billing does not
reset existing trials. Check the result with:

```sql
select enabled, trial_start_policy, activated_at
from public.billing_settings where singleton = true;

select business_id, trial_started_at, trial_ends_at,
       subscription_status, current_period_end, synced_at
from public.billing_accounts
order by business_id;
```

The billing tables have RLS enabled. Table access and function execution are
revoked from `public`, `anon` and `authenticated`; only the server role can
use them. Do not introduce client-side table access for billing.

## Checkout and the end of the free period

Owners may voluntarily choose Checkout while more than **48 hours and
30 minutes** remain in their free period. That subscription uses the original
stored trial end, with a payment method collected for renewal. It does not
restart the clock or charge for the remaining free time.

During the final 48 hours and 30 minutes, new Checkout is temporarily withheld
until the free period ends. This leaves room for Stripe's minimum trial
duration and Checkout completion; it does not shorten the promised trial or
invent an extra period. An already-created open Checkout may still be reused
until its safe expiry. An already-scheduled subscription remains manageable
through the portal during this time.

An owner who never opts in is never charged. At trial expiry their public chat
pauses until a verified paid subscription is active. The dashboard and saved
answers/enquiries remain accessible. Website rescans require entitlement once
the trial has begun; setup can still scan before first website verification.

Checkout persists its operation before calling Stripe, uses stable provider
idempotency keys and serialises concurrent work with a database lease. A lost
response is recovered using the existing customer/session, rather than
creating another charge attempt. An unresolved customer-creation attempt
older than 23 hours requires operator review before trying again because the
provider's idempotency window cannot safely be assumed indefinitely.

## Signed webhooks and reconciliation

Create an account-level **snapshot-event** destination at:

```text
https://saygday.ai/api/stripe/webhook
```

Use the test site's origin for tests. Select the pinned API version
**`2026-08-26.dahlia`**, matching `STRIPE_API_VERSION`. This is the stable
version offered by the live account's Workbench on 8 October 2026. The Node
SDK remains 23.0.0 with an explicit API-version override for all requests;
webhook validation uses the same version. Do not choose the preview release.
The historical sandbox record used Endive and is not current rollout evidence.
Connect-account events and mismatched API versions or live/test modes are
rejected. Subscribe to these events:

```text
checkout.session.completed
checkout.session.expired
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
customer.subscription.trial_will_end
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.payment_action_required
invoice.voided
invoice.marked_uncollectible
```

The endpoint verifies the raw body with `Stripe-Signature`, a five-minute
timestamp tolerance and the configured signing secret before reading or
mutating billing records. Payloads larger than 256 KiB are rejected. Do not
place JSON parsing or body-rewriting middleware in front of it.

Events request a fresh Stripe subscription read; their embedded historical
subscription snapshot is not copied into access state. A per-business lease
serialises writers, and the event receipt and subscription snapshot commit
together. Duplicate events are harmless; a failed commit remains retryable.
Old deliveries cannot overwrite current cancellation or payment state merely
because they arrived last. Events for unknown customer mappings are ignored,
never used to assign customers to businesses.

`billing-reconcile.mts` repairs missed deliveries every five minutes through
Netlify's scheduled-function mechanism. It selects up to 10 customers not
successfully synchronised in the last 12 hours, processes up to three at a
time and uses an 18-second work budget. It is not a public HTTP repair API.
Check the scheduled function's executions after deployment and monitor the
backlog; a fixed batch is not unlimited capacity.

An unexpired local trial survives a Stripe outage. After that, public access
requires all of: a valid single-price subscription in `active` state, an
exactly paid A$30 AUD invoice, a future paid-through timestamp, and a
successful Stripe sync less than **24 hours** old. A scheduled cancellation
retains access only while these conditions hold and its period has not ended.
`past_due`, `unpaid`, incomplete, paused and cancelled subscriptions do not
grant new paid access. Stripe `trialing` cannot extend the local free period.

Paid access stops at the earlier of period end or the 24-hour freshness
limit. This bounds stale access if both webhook delivery and reconciliation
fail. A database outage fails closed. There is no unlimited grace period,
no browser-owned subscription state and no success-URL entitlement. Public
chat responses are not cached across subscription changes; the next visitor
answer refresh must pass the current checks.

## Deployment order

The new migration's generated version (`20261004051312`) sorts before the
existing rescan migration (`20261004100000`). On an existing database, inspect
the applied migration history and apply **only the pending billing migration**
through the deployment's migration workflow. Do not replay the rescan or other
already-applied migrations to force filename order. A migration runner may
flag this older pending version; resolve that against the actual applied
history, and never mark SQL as applied before it has successfully run. On a
fresh isolated database, run all migrations in filename order.

1. Run `npm ci`, `npm test` and `npm run build`. The migrations are exercised
   against real Postgres through PGlite; Stripe API calls are mocked in the
   regression suite, so passing tests do not prove live account setup.
2. In an isolated test environment, apply all migrations in filename order,
   including `20261004051312_stripe_billing.sql`. Leave billing disabled.
3. Configure the test Price, portal, function environment and webhook. Deploy
   this branch's functions and frontend together. Confirm existing chats and
   no-card onboarding continue working while rollout is disabled.
4. Activate the isolated test database with `website_verified` and exercise
   the matrix below. Confirm that signup, website addition and scans leave
   the trial unstarted, first verification starts it once, and already-verified
   businesses receive a complete 14-day period from activation.
5. Repeat configuration using live-mode resources on the existing `saygdayai`
   Netlify project. Apply migrations before deploying code that needs them.
   Keep live activation separate from the code deployment and disabled until
   Stripe configuration and the isolated test checks pass.
6. Verify production webhook delivery, scheduled reconciliation, Settings,
   portal return and a signed-in account's billing state. Do not run a real
   paid Checkout just to test without the payer's explicit agreement.

The code and migrations do not activate billing automatically. Sandbox
configuration and test evidence are recorded separately; no production
migration or live deployment is implied.

## Testing on the existing deploy preview

Use the existing `saygdayai` project's Deploy Preview for this PR, with an
isolated Supabase branch and Stripe sandbox. Do not create another Netlify
project or change production-context values. Apply and verify the branch's
migrations before connecting the preview; a failed branch migration is a
setup blocker, never a reason to fall back to the production database.

Set environment overrides in the **deploy-preview context**:

| Setting | Scope and preview value |
|---|---|
| `VITE_SAYGDAY_SUPABASE_URL` | Builds: the isolated branch's HTTPS project origin. |
| `VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY` | Builds: that same branch's browser-safe publishable key. |
| `SAYGDAY_SUPABASE_URL` and `SAYGDAY_SUPABASE_SERVICE_ROLE_KEY` | Functions: the same isolated branch and its server-only service role key. |
| `SAYGDAY_STRIPE_*` | Functions: `SAYGDAY_STRIPE_MODE=test` and this sandbox's matching key, Price, portal configuration and webhook signing secret. |
| `SAYGDAY_PUBLIC_URL` | Functions: this preview's exact HTTPS origin, for example `https://deploy-preview-29--saygdayai.netlify.app`. |

Verify the browser and server Supabase settings identify the same branch.
Keep server keys in Functions scope; the build plugin does not read them.
Configure the sandbox webhook destination at the preview's
`/api/stripe/webhook` endpoint and use its signing secret. Rebuild after
changing build-scope settings so the browser bundle and policy agree.

`plugins/preview-csp` runs only for `deploy-preview`. It replaces the
production Supabase origin in the global CSP's `connect-src` with the exact
configured public branch origin, using Netlify's supported in-memory
`netlifyConfig.headers` build hook. Missing, malformed or production project
URLs fail the preview build. It changes no source files, other CSP directives,
embedded-chat headers or production/branch-deploy policies. The browser needs
no wildcard Supabase permission and no Stripe script permission.

Netlify automatically runs scheduled functions only on published production
deployments. A preview therefore does not exercise automatic five-minute
billing reconciliation. Use **Functions → billing-reconcile → Run now** on
the preview for a manual check, then confirm the automatic schedule separately
when production rollout is authorised. Signed webhooks and authenticated
billing-status refreshes remain available for preview tests.

See Netlify's [build plugin configuration API](https://docs.netlify.com/extend/develop-and-share/develop-build-plugins/#netlifyconfig)
and [scheduled function testing](https://docs.netlify.com/build/functions/scheduled-functions/).

## Test-mode acceptance matrix

Use [Stripe's test card documentation](https://docs.stripe.com/testing).
For successful interactive Checkout, use `4242 4242 4242 4242`, a future
expiry and a test CVC. Never use a real card in test mode. Use Stripe's
documented declined/authentication-required cards for those paths.

| Check | Expected result |
|---|---|
| New owner, no card | Signup, website addition and scans do not start the trial; first successful website verification starts 14 days, with no unsolicited Stripe customer or charge. |
| Existing business at activation | Already-verified businesses receive a complete 14-day window; unverified businesses wait for verification. No retroactive charge. |
| Double-click Upgrade / repeat request | One reusable Checkout attempt and no second subscription. |
| Upgrade before trial expiry | Every remaining free day is preserved; no replacement 14-day period. |
| Upgrade after expiry | Checkout states A$30/month AUD; public access resumes only after server verification. |
| Abandon Checkout / alter return query | No paid access; the dashboard never treats the return URL as proof of payment. |
| Successful payment | The server records the correct customer's subscription and paid-through date. |
| Declined payment / incomplete authentication | No unpaid subscription grants paid access; a recovery action remains available. |
| Cancel in portal | Renewal stops; access ends at the displayed period end, without deleting answers or enquiries. |
| Return from portal | Fresh status appears without assuming cancellation or payment succeeded. |
| Duplicate webhook | A replay succeeds harmlessly; the event is applied at most once. |
| Delayed/out-of-order webhook | An older notification cannot restore a cancelled or unpaid state. |
| Bad signature / altered raw body / wrong mode | Request is rejected before changing subscription state. |
| Stripe unavailable / webhook delivery delayed | No access is created from an unverified return; existing access follows the bounded freshness rule. |
| Database unavailable | Public chat and paid state fail closed; dashboard shows that status cannot be checked. |
| Trial or paid-through boundary | Public answers, answer counts and new enquiries stop when entitlement ends; owner data remains readable. |
| Website changed / second verification | Website ownership must be re-established; the original first-verification timestamp and trial dates do not reset. |
| Cross-owner request | A signed-in owner cannot inspect, upgrade or open a portal for another business. |
| Already-open visitor chat | The next answer refresh cannot reuse old approved answers after billing access is lost. |

Use a dedicated Stripe test customer and
[test clocks](https://docs.stripe.com/billing/testing/test-clocks) where
supported for renewal and cancellation lifecycle testing. Application trial
boundaries are also covered directly by the database regression tests.
Record webhook delivery results and the final server state, rather than
relying on the browser's “success” page.

The automated regression coverage is separate from those connected Stripe
smoke checks:

| Test file | Boundary exercised |
|---|---|
| `test/billing-database.test.mjs` | Real migrations in PGlite: inert rollout, first-verification trial start, immutable dates, service-role permissions, visitor gates, leases and atomic event receipts. |
| `test/billing-server.test.mjs` | Real Stripe SDK signed fixture generation and verification, with mocked provider API responses and real PGlite state: tampered/stale signatures, ownership, retries, event replay/order, concurrency, exact pricing and bounded outage recovery. |
| `test/billing-ui.test.mjs` | Dashboard state copy, server capability flags, safe redirects, refresh behaviour and return-query handling. |
| Existing matcher, widget and server suites | Approved answers remain exact; failed refresh cannot reuse stale answers; ownership and enquiry handling remain enforced. |

The signed fixtures exercise the SDK's actual `generateTestHeaderString` and
`constructEvent`; they do not prove that a deployed Stripe destination can
reach Netlify or that live account settings are correct. Record connected
smoke results during deployment rather than treating this checklist as a
claim that they have already run.

Critical regression assertions must be proved against deliberate broken
source, as `CLAUDE.md` requires. Run sabotage through `npm test`; restore the
source immediately, rerun the green suite, and never `git add` during sabotage.

## Operations and rollback

Monitor webhook non-2xx responses, repeated reconciliation failures and
accounts whose Stripe state has gone stale. Investigate using event IDs and
business IDs; never log secret keys, payment details or complete provider
payloads. Repair the cause, then replay failed signed events or reconcile the
customer. Do not manually turn a browser return into a paid entitlement.

Before activation, leaving rollout disabled is the safe rollback. After any
subscription exists, disabling application billing or reverting the website
**does not stop Stripe renewing that subscription**. Preserve webhook,
reconciliation and portal handling while fixing or rolling back UI changes.
If paid service must end, manage affected subscriptions in Stripe, tell the
owners what is happening and handle any required refund separately. Do not
drop billing tables, delete customer mappings or roll back to a pre-billing
deployment that cannot maintain subscription state.

Account closure needs the same care. Before deleting a business or its auth
user, verify in Stripe that its subscription has actually ended and no further
renewal will occur. A cancellation scheduled for period end is not immediate
closure: retain the customer mapping until that cancellation completes.
Deleting the business cascades to local billing records and does not cancel
anything in Stripe. There is no automatic account-deletion/payment-cancellation
workflow in this PR.

Already accepted customer enquiries continue their existing notification
delivery lifecycle if billing later pauses. Do not discard saved customer
questions or requeue historical enquiries as part of billing rollout.

## SayGday's own approved answers

The `site/own-chat.mjs` seed explains that billing is cancelled in Settings
through the portal. Existing production answers are owner-approved records;
the seed script deliberately does not overwrite them. Before activation,
the owner must review and approve the revised cancellation answer in
SayGday's own dashboard. Removing the widget line is no longer a valid
instruction for stopping subscription charges. No migration silently
rewrites approved business answers.

Stripe references: [webhook signatures and retries](https://docs.stripe.com/webhooks),
[portal configuration](https://docs.stripe.com/customer-management/configure-portal).

