# Stripe sandbox configuration and test record — 4 October 2026

Stripe account: `acct_1UA2PIR4lMiWCL26` (**hear is sandbox**).
All Stripe resources and transactions below have `livemode=false`; no real
payment was taken. PR [#29](https://github.com/UPD8-group/saygday.ai/pull/29)
remains open and unmerged. Production Netlify and Supabase are unchanged.

## Configuration recorded

| Resource | Result |
|---|---|
| Product `prod_VK8jzV3JyBAWAG` | Default price now points to the new monthly plan below. |
| Price `price_1UMjmSR4lMiWCL26eyX0pekf` | Active: AUD 3000 cents, recurring monthly, inclusive tax behaviour. |
| Portal `bpc_1UMjoPR4lMiWCL26TIGMj0vc` | Dedicated configuration: invoice history, payment-method updates and cancellation at period end with no proration. Plan, quantity and customer updates and pausing are disabled. |
| Previous A$30 price `price_1UJUTBR4lMiWCL26FWgRzC0p` | Archived. |
| Previous A$20 price `price_1UKR9wR4lMiWCL26jegynctG` | Already inactive. |
| Old webhook `we_1UJURzR4lMiWCL26v6HqcTh9` | Disabled; it targeted the old production route `/api/billing-webhook`. No replacement webhook was created. |
| Old default portal `bpc_1UJUWfR4lMiWCL26mYp50zj4` | Stripe refused to deactivate its default configuration. Renamed to identify it as legacy/superseded and its features restricted. The application must explicitly request the new dedicated configuration. |

Final Stripe reads confirmed the new monthly price is the only active price,
both older prices are inactive, and the sole webhook is the disabled legacy
endpoint. The subscription inventory contains exactly the three test
subscriptions below, all cancelled after testing.

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

Automated validation passed **170 tests via `npm test`** and the production
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

## Remaining setup and verification

The repository's settings for an isolated test deployment are:

| Variable | Sandbox value / remaining input |
|---|---|
| `SAYGDAY_STRIPE_MODE` | `test` |
| `SAYGDAY_STRIPE_PRICE_ID` | `price_1UMjmSR4lMiWCL26eyX0pekf` |
| `SAYGDAY_STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_1UMjoPR4lMiWCL26TIGMj0vc` |
| `SAYGDAY_STRIPE_SECRET_KEY` | Not available through the connected Stripe tools; requires Stripe Dashboard access. Do not put the key in this record or Git. |
| `SAYGDAY_STRIPE_WEBHOOK_SECRET` | Not created; obtain from the new isolated test endpoint after registering it. |
| `SAYGDAY_PUBLIC_URL` | The isolated test site's canonical HTTPS origin; site not provisioned. |

No Stripe environment secrets have been set. An isolated database and site
have not been created; a Supabase branch requires the relevant organisation
approval and cost decision. Keep production billing disabled and do not point
a test deployment at the production database. Follow [billing.md](billing.md)
for the complete configuration and activation procedure.

Still unverified:

- An actual monthly renewal, including Stripe Test Clock progression. Forcing
  a trial end tested initial payment failure, not the monthly renewal cycle.
- Authenticated Checkout/portal requests through a deployed SayGday app,
  using its runtime Stripe SDK and isolated database.
- Signed Stripe webhook delivery, duplicate delivery and retry recovery
  through the deployed endpoint end to end.

After provision of the isolated environment and its secrets, register
`/api/stripe/webhook` with the API version and events in the runbook, then
finish the deployment smoke checks before considering production activation.
