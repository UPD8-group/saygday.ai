# James, and affordable on purpose

Owner instruction: use James rather than Jay on SayGday, restore the pricing headline 'Spare change. On purpose.', and explain that the affordable price helps small businesses make their existing website more useful to customers amid cost-of-living pressure.

## Published copy

**Spare change. On purpose.**

With the cost of living putting pressure on small businesses, a more helpful website shouldn’t mean another big bill. For A$30 a month, SayGday helps customers find your answers, understand what you offer and feel more confident choosing your business.

### A small cost. A more helpful website.

Running a small business is expensive enough. We wanted SayGday to be something you can add to the website you already have, without taking on another big monthly bill.

Customers shouldn’t have to hunt for delivery details, opening hours or how to book. SayGday makes your approved answers easier to find, so visitors can work out whether your business is right for them—and take the next step when they’re ready.

## Scope

The current build-time publication layer uses James for the introduction, contact metadata, pricing FAQs, website-service guidance and terms references, including read-only preview pages. Earlier writing-bank documents and historical release scripts are not public copy and remain historical; this instruction takes precedence for future publications.

Restore the original heading and the existing `.spare.panel` layout; no stylesheet, image, font, navigation, login/form script, page journey or theme changes. The short cost/benefit explanation is in the pricing hero, so it is visible on mobile before Learn more. Longer context uses the existing panel treatment.

The one A$30/month software plan, seven-day card-backed live trial and separate scoped A$60/month-total oo.studio offer stay unchanged. No Stripe changes, billing-default changes, subscriptions, trial dates, access, messages or emails are part of this release.

`supabase/james-pricing-story.sql` updates only the verified SayGday brand's FAQ wording and name references. Its existing signed_by value is null and is left null, respecting the previous decision not to add a signer. Other businesses, including oo.studio's own chatbot, are outside this request.

## Verification

`test/pricing-story.test.mjs` checks every public page and 404 through the actual Vite transform, confirms no public nickname remains, verifies the heading and short mobile-visible copy, and checks unchanged prices, trial text, scripts, forms, image tags and stylesheets. Run the full existing test/build/billing-regression workflow before merging. After publication apply the narrowly scoped FAQ SQL and re-read its result. Report actual checks and deploy state in the PR; do not assume visual or payment testing occurred.
