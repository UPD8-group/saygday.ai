-- New card-backed Checkouts grant seven days. Preserve existing 14-day dates
-- and in-flight Checkouts by validating the exact persisted offer.
begin;
alter table public.billing_accounts drop constraint billing_accounts_check;
alter table public.billing_accounts add constraint billing_accounts_check check (
  (trial_started_at is null and trial_ends_at is null) or
  (trial_started_at is not null and trial_ends_at is not null and trial_ends_at in (trial_started_at + interval '7 days', trial_started_at + interval '14 days'))
);

create or replace function public.billing_commit(p_business uuid, p_lease uuid, p_state jsonb default null,
  p_checkout jsonb default null, p_event_id text default null, p_event_type text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  select * into a from public.billing_accounts where business_id = p_business for update;
  if not found or a.lease_token is distinct from p_lease or p_lease is null or a.lease_until <= clock_timestamp() then
    raise exception 'BILLING_LEASE_LOST' using errcode = 'P0001';
  end if;
  if p_event_id is not null then
    insert into public.billing_events(event_id, event_type, business_id) values (p_event_id, p_event_type, p_business)
      on conflict (event_id) do nothing;
    if not found then return jsonb_build_object('duplicate', true, 'account', public.billing_by_business(p_business)); end if;
  end if;
  if p_state is not null then
    if jsonb_typeof(p_state) <> 'object' or exists(select 1 from jsonb_object_keys(p_state) k
      where k not in ('stripe_customer_id','stripe_subscription_id','subscription_status','price_valid','current_period_end','cancel_at_period_end','synced_at','trial_started_at','trial_ends_at')) then
      raise exception 'INVALID_BILLING_STATE' using errcode = '22023';
    end if;
    if p_state ? 'trial_started_at' or p_state ? 'trial_ends_at' then
      if not a.card_required or a.trial_started_at is not null
        or a.first_website_verified_at is null or a.stripe_customer_id is null
        or coalesce((p_state->>'price_valid')::boolean, false) is not true
        or coalesce(p_state->>'subscription_status', '') not in ('trialing','active','canceled')
        or coalesce(p_state->>'stripe_subscription_id', '') !~ '^sub_[A-Za-z0-9]+$'
        or p_state->>'trial_started_at' is null or p_state->>'trial_ends_at' is null
        or (p_state->>'trial_started_at')::timestamptz < date_trunc('second', a.first_website_verified_at)
        or (p_state->>'trial_started_at')::timestamptz > clock_timestamp()
        or coalesce((a.checkout #>> '{params,subscription_data,trial_period_days}')::integer, 14) not in (7, 14)
        or (p_state->>'trial_ends_at')::timestamptz <> (p_state->>'trial_started_at')::timestamptz
          + make_interval(days => coalesce((a.checkout #>> '{params,subscription_data,trial_period_days}')::integer, 14)) then
        raise exception 'INVALID_CARD_TRIAL' using errcode = '22023';
      end if;
    end if;
    update public.billing_accounts set
      trial_started_at = coalesce(trial_started_at, (p_state->>'trial_started_at')::timestamptz),
      trial_ends_at = coalesce(trial_ends_at, (p_state->>'trial_ends_at')::timestamptz),
      stripe_customer_id = case when p_state ? 'stripe_customer_id' then p_state->>'stripe_customer_id' else stripe_customer_id end,
      stripe_subscription_id = case when p_state ? 'stripe_subscription_id' then p_state->>'stripe_subscription_id' else stripe_subscription_id end,
      subscription_status = case when p_state ? 'subscription_status' then p_state->>'subscription_status' else subscription_status end,
      price_valid = case when p_state ? 'price_valid' then (p_state->>'price_valid')::boolean else price_valid end,
      current_period_end = case when p_state ? 'current_period_end' then (p_state->>'current_period_end')::timestamptz else current_period_end end,
      cancel_at_period_end = case when p_state ? 'cancel_at_period_end' then (p_state->>'cancel_at_period_end')::boolean else cancel_at_period_end end,
      synced_at = case when p_state ? 'synced_at' then now() else synced_at end
      where business_id = p_business;
  end if;
  if p_checkout is not null then
    update public.billing_accounts set checkout = p_checkout where business_id = p_business;
  end if;
  return jsonb_build_object('duplicate', false, 'account', public.billing_by_business(p_business));
end;
$$;

revoke all on function public.billing_commit(uuid,uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.billing_commit(uuid,uuid,jsonb,jsonb,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
