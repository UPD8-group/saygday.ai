-- Apply after all versioned migrations. Reconciles Stripe billing with the
-- multiple-business dashboard, button colours and admin reporting added later.
-- Safe to reapply; never enables billing or resets trial dates.
begin;

drop function if exists public.billing_owner(uuid);
drop function if exists public.start_scan(uuid, text);
create or replace function public.billing_owner(p_user uuid, p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user, p_business);
begin
  perform public.billing_ensure(b.id);
  return public.billing_by_business(b.id);
end;
$$;

create or replace function public.billing_access(p_business uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select case when not s.enabled or exists(select 1 from public.businesses b where b.id = p_business and b.plan = 'internal') then true else
    coalesce(a.trial_ends_at > now(), false) or
    coalesce(a.subscription_status = 'active' and a.price_valid and a.current_period_end > now()
      and a.synced_at > now() - interval '24 hours' and a.synced_at <= now(), false) end
    from public.billing_settings s left join public.billing_accounts a on a.business_id = p_business where s.singleton), false)
$$;

create or replace function public.billing_by_business(p_business uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select (to_jsonb(a) - 'lease_token' - 'lease_until') || jsonb_build_object(
    'owner_id', b.owner_id, 'business_slug', b.slug, 'internal', b.plan = 'internal', 'enabled', s.enabled, 'trial_start_policy', s.trial_start_policy,
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

create or replace function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'buttonColour', b.button_colour, 'greeting', b.greeting, 'signedBy', b.signed_by, 'website', b.website,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id)
$$;

create or replace function public.button_seen(p_slug text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_business uuid;
begin
  update public.businesses set button_seen_at = now()
    where slug = p_slug and website_verified_at is not null and public.billing_access(id) and (button_seen_at is null or button_seen_at < now() - interval '1 hour')
    returning id into v_business;
  if not found then return false; end if;
  perform public.count_activity(v_business, 0, 1);
  return true;
end;
$$;

create or replace function public.faq_viewed(p_slug text, p_faq uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_business uuid;
begin
  update public.faqs f set views = f.views + 1 from public.businesses b
    where b.slug = p_slug and b.website_verified_at is not null and public.billing_access(b.id) and f.business_id = b.id and f.id = p_faq and f.status = 'approved'
    returning f.business_id into v_business;
  if not found then return false; end if;
  perform public.count_activity(v_business, 1, 0);
  return true;
end;
$$;

create or replace function public.start_scan(p_user uuid, p_website text, p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business); v_website text := public.clean_website(p_website); s public.scans;
begin
  if exists(select 1 from public.billing_accounts where business_id = v.id and trial_started_at is not null)
    and not public.billing_access(v.id) then
    raise exception 'BILLING_REQUIRED' using errcode = 'P0001';
  end if;
  select * into s from public.scans where business_id = v.id and status in ('queued','reading') and updated_at >= now() - interval '15 minutes'
    order by created_at desc limit 1;
  if found and s.website = v_website then return public.scan_json(s) || jsonb_build_object('started', false); end if;
  if not public.rate_limit('scan:' || v.id::text, 6, 86400) then raise exception 'SCAN_LIMIT' using errcode = 'P0001'; end if;
  -- An older scan of a different address is abandoned, never finished.
  update public.scans set status = 'failed', error = 'Replaced by a newer scan.', updated_at = now(), finished_at = now()
    where business_id = v.id and status in ('queued','reading');
  update public.businesses set website = v_website, updated_at = now() where id = v.id;
  insert into public.scans(business_id, website, stage) values (v.id, v_website, 'Starting') returning * into s;
  return public.scan_json(s) || jsonb_build_object('started', true);
end;
$$;

-- Stripe reconciliations update reporting; scheduling cancellation remains
-- paying until the subscription actually ends. Internal businesses stay excluded.
create or replace function public.billing_sync_plan()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; next_plan text;
begin
  if new.stripe_customer_id is null or new.synced_at is null then return new; end if;
  select * into b from public.businesses where id = new.business_id for update;
  if not found or b.plan = 'internal' then return new; end if;
  next_plan := case
    when new.subscription_status = 'active' and new.price_valid and new.current_period_end > now() then 'paying'
    when new.trial_ends_at > now() then 'trial'
    else 'cancelled' end;
  if b.plan <> next_plan then
    update public.businesses set plan = next_plan, plan_changed_at = now() where id = b.id;
    insert into public.plan_changes(business_id, plan) values (b.id, next_plan);
  end if;
  return new;
end;
$$;
drop trigger if exists billing_sync_plan on public.billing_accounts;
create trigger billing_sync_plan after update of subscription_status, price_valid, current_period_end, synced_at
  on public.billing_accounts for each row execute function public.billing_sync_plan();

create or replace function public.admin_business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'ownerId', b.owner_id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'buttonColour', b.button_colour, 'createdAt', b.created_at,
    'billing', (select jsonb_build_object('enabled', s.enabled, 'trialStartedAt', a.trial_started_at,
      'trialEndsAt', a.trial_ends_at, 'subscriptionStatus', a.subscription_status,
      'currentPeriodEnd', a.current_period_end, 'syncedAt', a.synced_at, 'priceValid', a.price_valid,
      'hasCustomer', a.stripe_customer_id is not null)
      from public.billing_settings s left join public.billing_accounts a on a.business_id = b.id where s.singleton),
    'plan', b.plan, 'planChangedAt', b.plan_changed_at,
    'websiteVerifiedAt', b.website_verified_at, 'verifiedBy', b.verified_by, 'buttonSeenAt', b.button_seen_at,
    'answers', (select jsonb_build_object(
        'approved', count(*) filter (where f.status = 'approved'),
        'drafts', count(*) filter (where f.status = 'draft'),
        'featured', count(*) filter (where f.featured),
        'fromScan', count(*) filter (where f.source = 'scan'),
        'written', count(*) filter (where f.source = 'owner'),
        'fromQuestions', count(*) filter (where f.source = 'enquiry'),
        'read', coalesce(sum(f.views), 0))
      from public.faqs f where f.business_id = b.id),
    'enquiries', (select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where e.status = 'new'),
        'withEmail', count(*) filter (where e.email is not null),
        'last30', count(*) filter (where e.created_at >= now() - interval '30 days'),
        'lastAt', max(e.created_at))
      from public.enquiries e where e.business_id = b.id),
    'scans', (select jsonb_build_object(
        'total', count(*),
        'done', count(*) filter (where public.admin_scan_state(s) = 'done'),
        'failed', count(*) filter (where public.admin_scan_state(s) = 'failed'),
        'firstDoneAt', min(s.finished_at) filter (where s.status = 'done'))
      from public.scans s where s.business_id = b.id),
    'lastScan', (select jsonb_build_object('status', public.admin_scan_state(s), 'createdAt', s.created_at,
        'pages', s.pages, 'drafted', s.drafted, 'error', s.error)
      from public.scans s where s.business_id = b.id order by s.created_at desc limit 1),
    'activity', (select jsonb_build_object(
        'read7', coalesce(sum(a.answers_read) filter (where a.day > (now() at time zone 'Australia/Sydney')::date - 7), 0),
        'read30', coalesce(sum(a.answers_read), 0),
        'liveDays7', count(*) filter (where a.button_hours > 0 and a.day > (now() at time zone 'Australia/Sydney')::date - 7),
        'liveDays30', count(*) filter (where a.button_hours > 0))
      from public.business_activity a where a.business_id = b.id and a.day > (now() at time zone 'Australia/Sydney')::date - 30)
  )
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'billing_%' or p.proname in
      ('widget','button_seen','faq_viewed','start_scan','admin_business_json'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';

