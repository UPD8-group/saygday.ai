-- Server-owned billing. The owner chose first successful website ownership
-- verification on 4 October 2026. Rollout remains inert until configured and enabled.
-- Never provision Stripe objects or expire an existing business in a migration.
begin;

-- Account-based trials use Auth's real server-recorded creation time. These
-- two columns are available only to the existing trusted service role.
grant usage on schema auth to service_role;
grant select (id, created_at) on auth.users to service_role;

create table public.billing_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  trial_start_policy text check (trial_start_policy in ('account_created','business_created','website_verified')),
  activated_at timestamptz,
  check (not enabled or (trial_start_policy is not null and activated_at is not null))
);
insert into public.billing_settings(singleton, trial_start_policy) values (true, 'website_verified');

create table public.billing_accounts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  account_created_at timestamptz not null,
  business_created_at timestamptz not null,
  first_website_verified_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  stripe_customer_id text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text unique check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  subscription_status text not null default 'none' check (subscription_status in
    ('none','incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused','conflict')),
  price_valid boolean not null default false,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  synced_at timestamptz,
  last_reconcile_attempt_at timestamptz,
  checkout jsonb not null default '{}'::jsonb check (jsonb_typeof(checkout) = 'object' and octet_length(checkout::text) <= 32768),
  lease_token uuid,
  lease_until timestamptz,
  check ((trial_started_at is null and trial_ends_at is null) or
    (trial_started_at is not null and trial_ends_at = trial_started_at + interval '14 days')),
  check ((lease_token is null) = (lease_until is null))
);
create index billing_accounts_reconcile_idx on public.billing_accounts(last_reconcile_attempt_at nulls first)
  where stripe_customer_id is not null;

-- A receipt is written in the same transaction as its billing snapshot.
-- Keep receipts: dropping old IDs would re-enable replay of old events.
create table public.billing_events (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]+$'),
  event_type text not null check (char_length(event_type) between 1 and 160),
  business_id uuid not null references public.billing_accounts(business_id) on delete cascade,
  processed_at timestamptz not null default clock_timestamp()
);
create index billing_events_business_idx on public.billing_events(business_id);

do $$
declare t text;
begin
  foreach t in array array['billing_settings','billing_accounts','billing_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- A trial is never moved by Checkout, webhooks, rescans, website changes or
-- disabling/re-enabling billing. Only the first policy event can initialise it.
create function public.billing_trial_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.trial_started_at is not null and
    (new.trial_started_at is distinct from old.trial_started_at or new.trial_ends_at is distinct from old.trial_ends_at) then
    raise exception 'BILLING_TRIAL_IMMUTABLE' using errcode = '22023';
  end if;
  if old.stripe_customer_id is not null and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'BILLING_CUSTOMER_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger billing_accounts_immutable before update on public.billing_accounts
  for each row execute function public.billing_trial_immutable();

create function public.billing_ensure(p_business uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; s public.billing_settings; a public.billing_accounts; began timestamptz;
begin
  select * into b from public.businesses where id = p_business;
  if not found then return; end if;
  insert into public.billing_accounts(business_id, account_created_at, business_created_at, first_website_verified_at)
    select b.id, u.created_at, b.created_at, b.website_verified_at
      from auth.users u where u.id = b.owner_id
    on conflict (business_id) do update set first_website_verified_at =
      coalesce(public.billing_accounts.first_website_verified_at, excluded.first_website_verified_at);
  select * into s from public.billing_settings where singleton;
  if not coalesce(s.enabled, false) then return; end if;
  select * into a from public.billing_accounts where business_id = p_business for update;
  if a.trial_started_at is not null then return; end if;
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

create function public.billing_business_changed()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform public.billing_ensure(new.id);
  return new;
end;
$$;
create trigger businesses_billing_created after insert on public.businesses
  for each row execute function public.billing_business_changed();
create trigger businesses_billing_verified after update of website_verified_at on public.businesses
  for each row execute function public.billing_business_changed();

create function public.billing_settings_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.activated_at is not null and
    (new.activated_at is distinct from old.activated_at or new.trial_start_policy is distinct from old.trial_start_policy) then
    raise exception 'BILLING_POLICY_IMMUTABLE' using errcode = '22023';
  end if;
  if new.enabled and new.trial_start_policy is null then
    raise exception 'BILLING_POLICY_REQUIRED' using errcode = '22023';
  end if;
  if old.activated_at is null then
    new.activated_at := case when new.enabled then clock_timestamp() else null end;
  end if;
  return new;
end;
$$;
create trigger billing_settings_guard before update on public.billing_settings
  for each row execute function public.billing_settings_guard();

create function public.billing_settings_activate()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare b record;
begin
  if new.enabled and not old.enabled then
    for b in select id from public.businesses loop perform public.billing_ensure(b.id); end loop;
  end if;
  return new;
end;
$$;
create trigger billing_settings_activate after update on public.billing_settings
  for each row execute function public.billing_settings_activate();

-- Backfill state, not trials. The migration's setting is disabled.
do $$
declare b record;
begin
  for b in select id from public.businesses loop perform public.billing_ensure(b.id); end loop;
end $$;

-- Stripe trialing can never extend the local no-card trial. A fresh paid
-- snapshot is required after it. Unknown, missing, stale or delinquent state
-- fails closed; cancellation at period end stays active through that period.
create function public.billing_access(p_business uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select case when not s.enabled then true else
    coalesce(a.trial_ends_at > now(), false) or
    coalesce(a.subscription_status = 'active' and a.price_valid and a.current_period_end > now()
      and a.synced_at > now() - interval '24 hours' and a.synced_at <= now(), false) end
    from public.billing_settings s left join public.billing_accounts a on a.business_id = p_business where s.singleton), false)
$$;

create function public.billing_by_business(p_business uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select (to_jsonb(a) - 'lease_token' - 'lease_until') || jsonb_build_object(
    'owner_id', b.owner_id, 'enabled', s.enabled, 'trial_start_policy', s.trial_start_policy,
    'access_allowed', public.billing_access(a.business_id),
    'access_reason', case when not s.enabled then 'billing_disabled'
      when a.trial_ends_at > now() then 'trial'
      when public.billing_access(a.business_id) then 'subscription'
      when a.subscription_status = 'active' and a.price_valid and a.current_period_end > now()
        and (a.synced_at is null or a.synced_at <= now() - interval '24 hours') then 'billing_unavailable'
      when a.trial_started_at is null then 'trial_not_started'
      when a.subscription_status in ('past_due','unpaid','incomplete','paused','conflict') then a.subscription_status
      when a.subscription_status = 'canceled' then 'canceled'
      else 'trial_expired' end)
    from public.billing_accounts a join public.businesses b on b.id = a.business_id
    cross join public.billing_settings s where a.business_id = p_business and s.singleton
$$;

create function public.billing_owner(p_user uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user);
begin
  perform public.billing_ensure(b.id);
  return public.billing_by_business(b.id);
end;
$$;

create function public.billing_by_customer(p_customer text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.billing_by_business(a.business_id) from public.billing_accounts a where a.stripe_customer_id = p_customer
$$;

create function public.billing_reconcile_batch(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(public.billing_by_business(d.business_id) order by d.last_reconcile_attempt_at nulls first), '[]'::jsonb)
    from (select business_id, last_reconcile_attempt_at from public.billing_accounts where stripe_customer_id is not null
      and (synced_at is null or synced_at <= now() - interval '12 hours')
      order by last_reconcile_attempt_at nulls first, business_id limit greatest(1, least(coalesce(p_limit, 10), 50))) d
$$;

-- A UUID fencing token protects all read-Stripe/write-DB operations. A slow
-- worker whose lease expires cannot overwrite a newer worker's snapshot.
create function public.billing_acquire(p_business uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare token uuid := gen_random_uuid();
begin
  update public.billing_accounts set lease_token = token, lease_until = clock_timestamp() + interval '90 seconds',
      last_reconcile_attempt_at = now()
    where business_id = p_business and (lease_until is null or lease_until <= clock_timestamp());
  if not found then return null; end if;
  return jsonb_build_object('lease', token, 'account', public.billing_by_business(p_business));
end;
$$;

create function public.billing_release(p_business uuid, p_lease uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.billing_accounts set lease_token = null, lease_until = null
    where business_id = p_business and lease_token = p_lease and lease_until > clock_timestamp();
  return found;
end;
$$;

create function public.billing_event_seen(p_event_id text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.billing_events where event_id = p_event_id)
$$;

create function public.billing_commit(p_business uuid, p_lease uuid, p_state jsonb default null,
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
      where k not in ('stripe_customer_id','stripe_subscription_id','subscription_status','price_valid','current_period_end','cancel_at_period_end','synced_at')) then
      raise exception 'INVALID_BILLING_STATE' using errcode = '22023';
    end if;
    update public.billing_accounts set
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

-- Keep every public serving path behind the same database check. The old
-- deployment's RPCs are covered too; no JavaScript-only enforcement window.
create or replace function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'greeting', b.greeting, 'signedBy', b.signed_by, 'website', b.website,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id)
$$;

create or replace function public.chat_website(p_slug text)
returns text language sql stable security invoker set search_path = '' as $$
  select b.website from public.businesses b where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id)
$$;

create or replace function public.button_seen(p_slug text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.businesses set button_seen_at = now()
    where slug = p_slug and website_verified_at is not null and public.billing_access(id)
      and (button_seen_at is null or button_seen_at < now() - interval '1 hour');
  return found;
end;
$$;

create or replace function public.faq_viewed(p_slug text, p_faq uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.faqs f set views = f.views + 1 from public.businesses b
    where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id)
      and f.business_id = b.id and f.id = p_faq and f.status = 'approved';
  return found;
end;
$$;

create or replace function public.ask_team(p_slug text, p_question text, p_email text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; e public.enquiries;
begin
  select * into b from public.businesses where slug = p_slug and website_verified_at is not null and public.billing_access(id);
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.enquiries(business_id, question, email)
  values (b.id, left(btrim(regexp_replace(p_question, '\s+', ' ', 'g')), 500), nullif(lower(btrim(coalesce(p_email, ''))), ''))
  returning * into e;
  return jsonb_build_object('id', e.id, 'businessName', b.name, 'notifyEmail', b.notify_email, 'question', e.question, 'email', e.email, 'createdAt', e.created_at);
end;
$$;
-- ask_team_queued delegates to ask_team in the same transaction, so it cannot
-- enqueue mail when billing blocks the enquiry.

create or replace function public.start_scan(p_user uuid, p_website text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user); v_website text := public.clean_website(p_website); s public.scans;
begin
  -- Setup remains usable before a verification-based trial starts. Once the
  -- trial has begun, scans require that trial or a paid subscription.
  if exists(select 1 from public.billing_accounts where business_id = v.id and trial_started_at is not null)
    and not public.billing_access(v.id) then
    raise exception 'BILLING_REQUIRED' using errcode = 'P0001';
  end if;
  select * into s from public.scans where business_id = v.id and status in ('queued','reading') and updated_at >= now() - interval '15 minutes'
    order by created_at desc limit 1;
  if found and s.website = v_website then return public.scan_json(s) || jsonb_build_object('started', false); end if;
  if not public.rate_limit('scan:' || v.id::text, 6, 86400) then raise exception 'SCAN_LIMIT' using errcode = 'P0001'; end if;
  update public.scans set status = 'failed', error = 'Replaced by a newer scan.', updated_at = now(), finished_at = now()
    where business_id = v.id and status in ('queued','reading');
  update public.businesses set website = v_website, updated_at = now() where id = v.id;
  insert into public.scans(business_id, website, stage) values (v.id, v_website, 'Starting') returning * into s;
  return public.scan_json(s) || jsonb_build_object('started', true);
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'billing_%' or p.proname in
      ('widget','chat_website','button_seen','faq_viewed','ask_team','start_scan'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
