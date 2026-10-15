# Approved release: current UX, new copy, A$59 / A$75

Owner instruction: “Change managed to 75 a month please - that's 2.50 a day then merge new copy please”.

This release supersedes the A$99 Managed proposal and preview-only instructions in the earlier writing pack. Earlier documents and `content-preview.mjs` are retained as the reviewed writing bank; `site/published-copy.mjs` is the final publication layer and source of the current offer. Both public and read-only review routes use it. There is no client-side text replacement.

## Published offers

- SayGday self-managed: A$59/month AUD; build and preview without a card; seven card-backed live days then monthly renewal unless cancelled.
- SayGday Managed: A$75/month AUD. “About A$2.50 a day, billed A$75 monthly. Daily comparison based on a 30-day month.”
- Managed remains enquiry-led. Existing scoped setup and monthly content allowance remain: up to 20 initial short answers, standard installation on one supported website and initial checks; up to 20 minutes of monthly review/small updates, no rollover. Extra work separately quoted. Owner approval retained.

## UX and production release

`site/vite-plugin.mjs` now applies the approved copy to the actual public routes, not only `/content-preview/`. Production contact forms, sign-in and the production chat remain intact. Only review routes use disabled forms/noindex and omit the live widget. Images, stylesheets, fonts, theme/menu/mobile UX code and navigation routes are unchanged. Terms identify the new-customer offer and expressly leave existing agreements and trial dates unchanged.

## Existing customer protection and new checkout

No global replacement of the legacy Stripe price or subscriptions. The deployed billing code already supports service-controlled per-account prices. The reviewed `supabase/new-customer-offer.sql` changes only the two column DEFAULTS for future billing-account inserts to the verified A$59 live price. It does not update existing rows, customer subscriptions, invoices, payment methods, entitlements or trial dates. Existing accounts therefore keep the legacy configuration or their existing explicit agreement. New accounts receive the A$59 pair, which the existing checkout, reconciliation and billing display already read.

Verified live catalogue IDs (not secrets):
- A$59 self-managed: `price_1UQwkRR8qEoKoynxsgmnPqqX`.
- A$75 Managed: `price_1UQwoQR8qEoKoynxsA2ojHYu` (enquiry-led; never automatically assigned).

Release the new pages, apply the reviewed new-account defaults, and align the SayGday business's own pricing/trial/inclusions chat answers. Do not change another business's answers. Check database defaults and compare existing billing rows before/after; verify published build status. No real payment or enquiry should be submitted as a test.

## Tests

`test/published-copy.test.mjs` covers actual Vite publication, every public page, preserved forms/scripts/images/styles, both prices, daily qualification and existing-customer terms. `test/new-customer-offer.test.mjs` applies the exact SQL in isolated Postgres, verifies existing billing rows and trial dates are unchanged, validates both legacy and new prices, and exercises new-price Checkout with a fake Stripe client. Existing regression suites remain unchanged.
