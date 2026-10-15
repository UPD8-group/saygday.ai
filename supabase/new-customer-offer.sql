-- Current single-plan offer: A$30/month for FUTURE billing-account inserts.
-- Reuses the verified active inclusive AUD monthly Stripe price.
-- No existing rows, subscriptions, agreements, trial dates or access change.
-- Existing service-controlled price overrides (including A$59/A$75) remain
-- valid in the existing Checkout/reconciliation/account-display code.
-- The A$60 oo.studio service is enquiry-led, not an automatic plan switch.
begin;
alter table public.billing_accounts
  alter column price_override_id set default 'price_1UOA0sR8qEoKoynxWAoOrDeA',
  alter column price_override_amount set default 3000;
notify pgrst, 'reload schema';
commit;
