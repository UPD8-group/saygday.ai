-- Single-use, email-bound complimentary access, controlled by the founder's
-- verified account. Codes are hashed before storage and never returned by SQL.
begin;
create table if not exists public.billing_complimentary_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  recipient_email text not null check (char_length(recipient_email) between 3 and 254),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  claimed_business_id uuid references public.businesses(id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz
);
create index if not exists billing_complimentary_codes_creator_idx
  on public.billing_complimentary_codes(created_by, created_at desc);
alter table public.billing_complimentary_codes enable row level security;
revoke all on public.billing_complimentary_codes from public, anon, authenticated, service_role;
grant select, insert, update on public.billing_complimentary_codes to service_role;
alter table public.billing_accounts add column if not exists complimentary boolean not null default false;
alter table public.billing_accounts add column if not exists complimentary_code_id uuid
  references public.billing_complimentary_codes(id);

create or replace function public.billing_code_admin(p_user uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(select 1 from public.billing_exempt_owners where user_id = p_user)
$$;

create or replace function public.billing_code_json(c public.billing_complimentary_codes)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'email', c.recipient_email,
    'createdAt', c.created_at, 'expiresAt', c.expires_at, 'redeemedAt', c.redeemed_at,
    'revokedAt', c.revoked_at, 'claimed', c.claimed_business_id is not null,
    'website', (select website from public.businesses where id = c.claimed_business_id))
$$;

create or replace function public.billing_code_create(p_user uuid, p_email text, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.billing_complimentary_codes;
begin
  if not public.billing_code_admin(p_user) then raise exception 'CODE_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_email is null or p_email <> lower(btrim(p_email)) or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_CODE_EMAIL' using errcode = '22023';
  end if;
  insert into public.billing_complimentary_codes(created_by, recipient_email, code_hash)
    values (p_user, p_email, p_hash) returning * into c;
  return public.billing_code_json(c);
end;
$$;

create or replace function public.billing_code_list(p_user uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if not public.billing_code_admin(p_user) then raise exception 'CODE_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(public.billing_code_json(c) order by c.created_at desc)
    from (select * from public.billing_complimentary_codes where created_by=p_user order by created_at desc limit 100) c), '[]'::jsonb);
end;
$$;

-- The lease serializes redemption against Checkout and webhook writers. A
-- claim reserves the code for one website, including retries after Stripe fails.
create or replace function public.billing_code_claim(p_user uuid, p_email text, p_business uuid, p_hash text, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user,p_business);
  a public.billing_accounts; c public.billing_complimentary_codes;
begin
  select * into a from public.billing_accounts where business_id=b.id for update;
  if not found or p_lease is null or a.lease_token is distinct from p_lease or a.lease_until <= clock_timestamp() then
    raise exception 'BILLING_LEASE_LOST' using errcode='P0001';
  end if;
  select * into c from public.billing_complimentary_codes where code_hash=p_hash for update;
  if not found or c.revoked_at is not null or c.recipient_email is distinct from lower(btrim(p_email))
    or (a.complimentary and a.complimentary_code_id is distinct from c.id)
    or (c.claimed_business_id is not null and c.claimed_business_id <> b.id)
    or (c.redeemed_at is not null and (c.claimed_business_id is distinct from b.id or not a.complimentary))
    or (c.redeemed_at is null and c.expires_at <= now()) then
    raise exception 'INVALID_COMPLIMENTARY_CODE' using errcode='P0001';
  end if;
  update public.billing_complimentary_codes set claimed_business_id=b.id where id=c.id;
  return jsonb_build_object('alreadyRedeemed', c.redeemed_at is not null);
end;
$$;

create or replace function public.billing_code_redeem(p_user uuid, p_email text, p_business uuid, p_hash text, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.billing_complimentary_codes;
begin
  perform public.billing_code_claim(p_user,p_email,p_business,p_hash,p_lease);
  select * into c from public.billing_complimentary_codes where code_hash=p_hash for update;
  update public.billing_accounts set complimentary=true, complimentary_code_id=c.id where business_id=p_business;
  update public.billing_complimentary_codes set redeemed_at=coalesce(redeemed_at,now()) where id=c.id;
  return public.billing_by_business(p_business);
end;
$$;

create or replace function public.billing_code_revoke(p_user uuid, p_code uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.billing_complimentary_codes; a public.billing_accounts; v_business uuid;
begin
  if not public.billing_code_admin(p_user) then raise exception 'CODE_ADMIN_REQUIRED' using errcode='42501'; end if;
  -- Match redemption's account-before-code lock order to avoid a deadlock.
  select claimed_business_id into v_business from public.billing_complimentary_codes where id=p_code and created_by=p_user;
  if v_business is not null then
    select * into a from public.billing_accounts where business_id=v_business for update;
    if a.lease_until > clock_timestamp() then raise exception 'BILLING_CODE_BUSY' using errcode='P0001'; end if;
  end if;
  select * into c from public.billing_complimentary_codes where id=p_code and created_by=p_user for update;
  if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
  if c.claimed_business_id is distinct from v_business then raise exception 'BILLING_CODE_BUSY' using errcode='P0001'; end if;
  update public.billing_complimentary_codes set revoked_at=coalesce(revoked_at,now()) where id=c.id returning * into c;
  update public.billing_accounts set complimentary=false, complimentary_code_id=null where complimentary_code_id=c.id;
  return public.billing_code_json(c);
end;
$$;

create or replace function public.billing_clear_transferred_complimentary()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare a public.billing_accounts;
begin
  if old.owner_id is distinct from new.owner_id then
    select * into a from public.billing_accounts where business_id=new.id for update;
    if a.lease_until > clock_timestamp() then raise exception 'BILLING_CODE_BUSY' using errcode='P0001'; end if;
    update public.billing_accounts set complimentary=false, complimentary_code_id=null where business_id=new.id;
    update public.billing_complimentary_codes set revoked_at=coalesce(revoked_at,now()) where id=a.complimentary_code_id;
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_clear_transferred_complimentary on public.businesses;
create trigger businesses_clear_transferred_complimentary after update of owner_id on public.businesses
  for each row execute function public.billing_clear_transferred_complimentary();

create or replace function public.billing_access(p_business uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select case when not s.enabled or a.complimentary
    or exists(select 1 from public.businesses b where b.id=p_business and b.plan='internal') then true else
    coalesce(a.trial_ends_at > now(),false) or
    coalesce(a.subscription_status='active' and a.price_valid and a.current_period_end > now()
      and a.synced_at > now()-interval '24 hours' and a.synced_at <= now(),false) end
    from public.billing_settings s left join public.billing_accounts a on a.business_id=p_business where s.singleton),false)
$$;

create or replace function public.admin_business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'ownerId', b.owner_id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'buttonColour', b.button_colour, 'createdAt', b.created_at,
    'billing', (select jsonb_build_object('enabled', s.enabled, 'complimentary', coalesce(a.complimentary,false), 'trialStartedAt', a.trial_started_at,
      'trialEndsAt', a.trial_ends_at, 'subscriptionStatus', a.subscription_status,
      'currentPeriodEnd', a.current_period_end, 'syncedAt', a.synced_at, 'priceValid', a.price_valid, 'monthlyAmount', coalesce(a.price_override_amount,4000),
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

-- Public-role access stays disabled, including helpers and trigger functions.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'billing_code_%' or p.proname='billing_clear_transferred_complimentary')
  loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
