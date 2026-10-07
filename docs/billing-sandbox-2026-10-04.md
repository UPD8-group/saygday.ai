# Stripe sandbox configuration and test record — 4 October 2026

Stripe account: `acct_1UA2PIR4lMiWCL26` (**hear is sandbox**).
All Stripe resources and transactions below have `livemode=false`; no real
payment was taken. PR [#29](https://github.com/UPD8-group/saygday.ai/pull/29)
remains open and unmerged. Production Netlify and Supabase are unchanged.
The isolated preview configuration below changes only Netlify's
`deploy-preview` context; production effective values and scopes were checked
and remain unchanged.

## Configuration recorded

| Resource | Result |
|---|---|
| Product `prod_VK8jzV3JyBAWAG` | Default price now points to the new monthly plan below. |
| Price `price_1UMjmSR4lMiWCL26eyX0pekf` | Active: AUD 3000 cents, recurring monthly, inclusive tax behaviour. |
| Portal `bpc_1UMjoPR4lMiWCL26TIGMj0vc` | Dedicated configuration: invoice history, payment-method updates and cancellation at period end with no proration. Plan, quantity and customer updates and pausing are disabled. |
| Previous A$30 price `price_1UJUTBR4lMiWCL26FWgRzC0p` | Archived. |
| Previous A$20 price `price_1UKR9wR4lMiWCL26jegynctG` | Already inactive. |
| Old webhook `we_1UJURzR4lMiWCL26v6HqcTh9` | Disabled; it targeted the old production route `/api/billing-webhook`. |
| Preview webhook `we_1UMnSKR4lMiWCL26Gqs2o6Zc` | Created for `https://deploy-preview-29--saygdayai.netlify.app/api/stripe/webhook`, API `2026-09-30.endive`, with the runbook's 16 events; immediately disabled pending runtime credentials and deployment checks. |
| Old default portal `bpc_1UJUWfR4lMiWCL26mYp50zj4` | Stripe refused to deactivate its default configuration. Renamed to identify it as legacy/superseded and its features restricted. The application must explicitly request the new dedicated configuration. |

Stripe reads after payment testing confirmed the new monthly price is the
only active price and both older prices are inactive. Both the legacy and new
preview webhooks are disabled. The subscription inventory contains exactly
the three test subscriptions below, all cancelled after testing.

The agreed offer remains **A$30/month AUD, with 14 free days and no card
required to start**. The free period starts at first successful website
ownership verification. An early subscription preserves the exact remaining
trial; it never starts another 14 days. Existing verified businesses receive
the documented full-period safeguard when application billing is activated.

## Connected Stripe checks completed

These checks used actual sandbox Stripe resources and hosted Stripe pages.
They did **not** exercise the deployed SayGday application's authenticated
billing endpoints or its webhook delivery path.

| Check | Observed result | Stripe records |
|---|---|---|
| Hosted Checkout | Completed; A$30 AUD invoice paid. | Subscription `sub_1UMjw1R4lMiWCL26q9XKGVmp`; invoice `in_1UMjw0R4lMiWCL265BKR3s1R`. |
| Paid subscription and hosted portal cancellation | Directly created sandbox subscription paid A$30 AUD. The real hosted portal then scheduled cancellation for **4 November 2026**. | Subscription `sub_1UMjryR4lMiWCL26f80zotFG`; invoice `in_1UMjryR4lMiWCL26nFvJgs6c`. |
| Remaining trial and failed first payment | Preserved an exact five-day remaining trial with an initial zero-value invoice. Forcing that trial to end with a declining test card produced a `past_due` subscription and an unpaid A$30 AUD invoice. | Subscription `sub_1UMjxuR4lMiWCL2605r9z7Id`; unpaid invoice `in_1UMjzgR4lMiWCL26Gqj7KSq4`. |

[Hosted portal cancellation screenshot](billing-sandbox-cancellation-2026-10-04.jpg)
was captured before test cleanup. Its scheduled cancellation date records
that test result, not the subscriptions' eventual cleanup status.

**Cleanup confirmed:** all three test subscriptions above now have status
`canceled` and `livemode=false`, with no proration or final invoice. The unpaid
failure-test invoice `in_1UMjzgR4lMiWCL26Gqj7KSq4` now has status `void`.

## Findings incorporated into the implementation

- This sandbox's Managed Payments account default conflicted with the direct
  fixed-price offer. Checkout now explicitly sends
  `managed_payments.enabled=false`; account-wide settings were not changed.
- Hosted portal cancellation returned an explicit `cancel_at` date while
  `cancel_at_period_end` was false. Reconciliation now recognises either
  representation and caps access at the earlier of the paid period end or
  cancellation date. A cancellation date cannot extend access.

The earlier billing validation passed **170 tests via `npm test`** and the production
build, with intentional mutation checks detecting broken critical behaviour. Those regression checks
complement the connected Stripe checks; they do not establish that a deployed
application or scheduled renewal works end to end.

Actual sandbox Stripe response fixtures also passed the current
`subscriptionSnapshot` and `publicBilling` functions locally: both paid paths
granted access, the original trial retained access, overdue payment denied
access, and explicit `cancel_at` produced `canceling` with access capped at the
paid end. Final cancelled response fixtures for all three subscriptions
produced `canceled` with no access. This validates the observed response shapes
against application logic, rather than claiming a deployed runtime or webhook
test.

## Isolated preview setup — later on 4 October 2026

The user created Supabase branch **`saygday-billing-sandbox`**, project
`yupjxevdhcwwrgpdlaix`, in **oo studio**, under parent
`plcowhnsmrgenzsohbrl`, with `with_data=false`.

The initial branch workflow failed: five inherited migration-history entries
through `signed_by` had `NULL` statements, leaving no application schema.
Creating `enquiry_notifications` then failed with `42P01` because its referenced
`enquiries` table did not exist. Recovery applied one atomic, guarded
`sandbox_repository_baseline` migration, version **`20261004111537`**, built
from all eight repository SQL migrations in filename order with their outer
transaction wrappers removed. Guards required an empty public schema and no
auth users.

Post-recovery checks passed: **9 tables with RLS**, **52 functions using
`SECURITY INVOKER`**, browser-role access revoked and service-role grants
correct. No auth users, businesses or Stripe events were present. Billing is
disabled, `trial_start_policy=website_verified`, and `activated_at` is null.
The database runtime is `ACTIVE_HEALTHY`; the branch workflow still displays
the historical `MIGRATIONS_FAILED` marker. This empty-sandbox recovery baseline
must **not** be merged into production.

The existing PR preview is
[deploy-preview-29--saygdayai.netlify.app](https://deploy-preview-29--saygdayai.netlify.app).
No separate hosting project was created. Its `deploy-preview` environment is
configured as follows; runtime secret values are deliberately omitted:

| Variable | Preview value / current status |
|---|---|
| `SAYGDAY_SUPABASE_URL`, `VITE_SAYGDAY_SUPABASE_URL` | Set to `https://yupjxevdhcwwrgpdlaix.supabase.co`. |
| `VITE_SAYGDAY_SUPABASE_PUBLISHABLE_KEY` | Active sandbox publishable key configured. |
| `SAYGDAY_SUPABASE_SERVICE_ROLE_KEY` | Missing sandbox runtime credential. |
| `SAYGDAY_STRIPE_MODE` | Set to `test`. |
| `SAYGDAY_STRIPE_PRICE_ID` | Set to `price_1UMjmSR4lMiWCL26eyX0pekf`. |
| `SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID` | Set to `bpc_1UMjoPR4lMiWCL26TIGMj0vc`. |
| `SAYGDAY_STRIPE_SECRET_KEY` | Missing test-mode runtime credential. |
| `SAYGDAY_STRIPE_WEBHOOK_SECRET` | Securely configured, Netlify Functions scope, `deploy-preview` context only. |
| `SAYGDAY_PUBLIC_URL` | Set to `https://deploy-preview-29--saygdayai.netlify.app`. |
| `RESEND_API_KEY` | Missing; required to test preview sign-in. |
| `ANTHROPIC_API_KEY` | Optional for website-scan testing. |

The connected tools do not expose the missing secret keys, and browser
authentication has not been completed. An authorised operator can enter them
directly in the preview environment settings; do not place credentials in this
record, chat or Git. Keep the webhook and billing disabled until the preview
runtime is ready. The preview-only Content Security Policy build plugin is
implemented. All **176 tests** and the production build pass, including six
new CSP regressions. Deliberately removing its production safeguards caused
two expected test failures; the source was restored before the green run.
Verification of the deployed preview headers follows publication.

## Remaining verification

Follow [billing.md](billing.md) for configuration and activation. The database
and environment setup above do not establish that the deployed integration
works.

Still unverified:

- An actual monthly renewal, including Stripe Test Clock progression. Forcing
  a trial end tested initial payment failure, not the monthly renewal cycle.
- Authenticated Checkout/portal requests through a deployed SayGday app,
  using its runtime Stripe SDK and isolated database.
- Signed Stripe webhook delivery, duplicate delivery and retry recovery
  through the deployed endpoint end to end.

After the missing runtime credentials are set and the preview changes are
verified and deployed, enable the existing preview webhook and finish the
deployment smoke checks before considering production activation.

