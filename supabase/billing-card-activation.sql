-- 8 October 2026: free drafting/preview, payment method before public activation.
-- Run after versioned migrations and billing-upgrade.sql. Safe to reapply.
-- Preserve all already-started trials and never create or charge a subscription.
begin;
alter table public.billing_settings add column if not exists require_card_for_new_trials boolean not null default false;
alter table public.billing_accounts add column if not exists card_required boolean not null default true;
-- The new column defaults true. Only already-started legacy trials are exempt.
-- Do not exempt a new card-backed trial when this script is reapplied.
update public.billing_accounts set card_required = false
  where trial_started_at is not null and not (select require_card_for_new_trials from public.billing_settings where singleton);
update public.billing_accounts set card_required = true where trial_started_at is null;
update public.billing_settings set require_card_for_new_trials = true where singleton;

create or replace function public.billing_ensure(p_business uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; s public.billing_settings; a public.billing_accounts; began timestamptz;
begin
  select * into b from public.businesses where id = p_business;
  if not found then return; end if;
  insert into public.billing_accounts(business_id, account_created_at, business_created_at, first_website_verified_at, card_required)
    select b.id, u.created_at, b.created_at, b.website_verified_at,
      (select require_card_for_new_trials from public.billing_settings where singleton)
      from auth.users u where u.id = b.owner_id
    on conflict (business_id) do update set first_website_verified_at =
      coalesce(public.billing_accounts.first_website_verified_at, excluded.first_website_verified_at);
  select * into s from public.billing_settings where singleton;
  if not coalesce(s.enabled, false) then return; end if;
  select * into a from public.billing_accounts where business_id = p_business for update;
  if a.trial_started_at is not null or a.card_required then return; end if;
  began := case s.trial_start_policy when 'account_created' then a.account_created_at
    when 'business_created' then a.business_created_at when 'website_verified' then a.first_website_verified_at end;
  if began is null then return; end if;
  -- Existing accounts receive a fresh 14 days from activation; their old signup
  -- dates cannot make the first billing rollout unexpectedly switch them off.
  began := greatest(began, s.activated_at);
  update public.billing_accounts set trial_started_at = began, trial_ends_at = began + interval '14 days'
    where business_id = p_business and trial_started_at is null;
end;
$$;


create or replace function public.billing_by_business(p_business uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select (to_jsonb(a) - 'lease_token' - 'lease_until') || jsonb_build_object(
    'owner_id', b.owner_id, 'business_slug', b.slug, 'internal', b.plan = 'internal', 'website_verified', b.website_verified_at is not null, 'enabled', s.enabled, 'trial_start_policy', s.trial_start_policy,
    'access_allowed', public.billing_access(a.business_id),
    'access_reason', case when not s.enabled then 'billing_disabled'
      when a.trial_ends_at > now() then 'trial'
      when public.billing_access(a.business_id) then 'subscription'
      when a.subscription_status = 'active' and a.price_valid and a.current_period_end > now()
        and (a.synced_at is null or a.synced_at <= now() - interval '24 hours') then 'billing_unavailable'
      when a.trial_started_at is null and a.card_required and b.website_verified_at is not null then 'card_required'
      when a.trial_started_at is null then 'trial_not_started'
      when a.subscription_status in ('past_due','unpaid','incomplete','paused','conflict') then a.subscription_status
      when a.subscription_status = 'canceled' then 'canceled'
      else 'trial_expired' end)
    from public.billing_accounts a join public.businesses b on b.id = a.business_id
    cross join public.billing_settings s where a.business_id = p_business and s.singleton
$$;


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
        or (p_state->>'trial_ends_at')::timestamptz <> (p_state->>'trial_started_at')::timestamptz + interval '14 days' then
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


revoke all on function public.billing_ensure(uuid), public.billing_by_business(uuid),
  public.billing_commit(uuid,uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.billing_ensure(uuid), public.billing_by_business(uuid),
  public.billing_commit(uuid,uuid,jsonb,jsonb,text,text) to service_role;
notify pgrst, 'reload schema';
commit;
