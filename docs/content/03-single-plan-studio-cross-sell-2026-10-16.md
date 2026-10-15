# Current approved offer — one SayGday plan and an oo.studio cross-sell

Owner approved: A$30/month self-service SayGday, no standalone Managed tier; oo.studio A$60/month TOTAL for the scoped website/refresh, shop setup where needed, hosting/care and SayGday included. Preserve both brands' current designs. This supersedes the earlier A$59/A$75 and A$99 proposals.

`site/published-copy.mjs` renders current public and review copy. Pricing has ONE software price card and a distinct oo.studio website-service section, not a second chatbot tier. On phones the secondary studio link is visible without expanding Learn more. Other imagery, stylesheets, navigation, theme/menu behavior, live forms and scripts are unchanged. The sign-in → website scan → answer approval flow remains self-service.

A$30 uses the already active inclusive AUD monthly catalogue price `price_1UOA0sR8qEoKoynxWAoOrDeA`. The independent studio catalogue price remains `price_1UPrnCR8qEoKoynxWMEuKT4A` (A$60 monthly). No duplicate prices, subscriptions, payment links, invoices or charges are created. Earlier prices remain available for existing agreements rather than being archived out from under unpaid account setups.

`supabase/new-customer-offer.sql` changes only future billing-account INSERT defaults to the A$30 ID/amount pair. No existing billing rows, subscriptions, saved dates, internal/complimentary access or customer-specific prices are rewritten. The existing billing code reads and validates the per-account pair, and is not modified. Seven-day trial and cancellation behavior stay intact.

The oo.studio service is enquiry-led. Its A$60 includes SayGday for the covered website; it is NOT A$90 and does not require a second software subscription. Existing subscribers must contact Jay to coordinate any move and included access before paying for both. Cross-links perform no billing mutations. The software free week does not include website-build work. Pages, catalogue/setup, supported integrations and ongoing work are agreed first; processing fees, agreed third-party costs and out-of-scope work are separate.

Release checklist: pass the published-page, isolated database/Checkout and existing billing regression tests; merge; confirm exact production deploy; apply the future-defaults migration; align the verified SayGday and active oo.studio chatbot FAQ entries; verify defaults and unchanged existing billing agreements. Update the oo.studio homepage with the reciprocal standalone link and bundle-total wording. Do not change any client website or client FAQ.

No claim of a completed live payment or browser visual test is made by this document. Record actual results in the pull-request release notes.
