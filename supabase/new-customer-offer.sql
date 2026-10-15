-- Approved 16 October 2026: A$59 self-managed for NEW billing accounts.
-- Run as a reviewed migration when the new public copy is released.
-- The price ID is the verified live Stripe catalogue price, not a customer ID.
-- Existing rows are deliberately not updated: this pins the new offer only
-- when a billing account is first inserted. Existing A$30/A$40 subscriptions,
-- explicit A$60/other agreements, internal/complimentary access and all trial
-- dates keep the existing billing code and validation. No Stripe subscription
-- is changed. No customer is charged by this SQL.
-- billing_ensure inserts omit these two columns, and its ON CONFLICT update
-- does not overwrite them. The existing accountBillingConfiguration reads
-- this service-controlled pair for checkout, reconciliation and display.
begin;
alter table public.billing_accounts
  alter column price_override_id set default 'price_1UQwkRR8qEoKoynxsgmnPqqX',
  alter column price_override_amount set default 5900;
notify pgrst, 'reload schema';
commit;
