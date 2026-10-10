-- Independent, business-scoped access for a studio portal. No shared auth,
-- service key, subscription, or database. Browsers cannot read these rows.
create table public.integration_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  website text not null,
  client_id text not null check (client_id = 'oo-studio'),
  challenge text not null check (challenge ~ '^[A-Za-z0-9_-]{43}$'),
  redirect_uri text not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.integration_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  website text not null,
  client_id text not null check (client_id = 'oo-studio'),
  expires_at timestamptz not null default now() + interval '365 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index integration_codes_owner_idx on public.integration_codes(owner_id, business_id);
create index integration_grants_owner_idx on public.integration_grants(owner_id, business_id);
alter table public.integration_codes enable row level security;
alter table public.integration_grants enable row level security;
revoke all on public.integration_codes, public.integration_grants from public, anon, authenticated;
grant all on public.integration_codes, public.integration_grants to service_role;

create function public.integration_authorize(p_user uuid, p_business uuid, p_code_hash text, p_challenge text, p_redirect_uri text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user, p_business);
begin
  if b.website_verified_at is null then raise exception 'INTEGRATION_UNVERIFIED' using errcode='22023'; end if;
  delete from public.integration_codes where expires_at < now();
  insert into public.integration_codes(code_hash, owner_id, business_id, website, client_id, challenge, redirect_uri)
    values(p_code_hash, p_user, b.id, b.website, 'oo-studio', p_challenge, p_redirect_uri);
  return true;
end;
$$;

-- Lock before consuming: two concurrent exchanges cannot both obtain a token.
create function public.integration_exchange(p_code_hash text, p_challenge text, p_redirect_uri text, p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.integration_codes; g public.integration_grants; b public.businesses;
begin
  select * into c from public.integration_codes where code_hash = p_code_hash for update;
  if not found or c.consumed_at is not null or c.expires_at <= now()
    or c.challenge <> p_challenge or c.redirect_uri <> p_redirect_uri then return null; end if;
  b := public.owned_business(c.owner_id, c.business_id);
  if b.website <> c.website or b.website_verified_at is null then return null; end if;
  update public.integration_codes set consumed_at = now() where code_hash = p_code_hash;
  insert into public.integration_grants(token_hash, owner_id, business_id, website, client_id)
    values(p_token_hash, c.owner_id, c.business_id, c.website, c.client_id) returning * into g;
  return jsonb_build_object('id',g.id,'ownerId',g.owner_id,'businessId',g.business_id,'expiresAt',g.expires_at);
end;
$$;

create function public.integration_resolve(p_token_hash text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',g.id,'ownerId',g.owner_id,'businessId',g.business_id,'expiresAt',g.expires_at)
  from public.integration_grants g join public.businesses b on b.id=g.business_id and b.owner_id=g.owner_id
  where g.token_hash=p_token_hash and g.revoked_at is null and g.expires_at > now()
    and b.website=g.website and b.website_verified_at is not null
$$;

create function public.integration_list(p_user uuid, p_business uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user, p_business);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'client','oo.studio','createdAt',g.created_at,'expiresAt',g.expires_at) order by g.created_at desc)
    from public.integration_grants g where g.owner_id=p_user and g.business_id=b.id and g.revoked_at is null and g.expires_at > now()),'[]'::jsonb);
end;
$$;

create function public.integration_revoke(p_user uuid, p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.integration_grants set revoked_at=coalesce(revoked_at,now()) where id=p_id and owner_id=p_user;
  return found;
end;
$$;

-- Resolve and execute in one transaction. Revocation takes the same grant
-- lock; changes of website/owner or an account ban take the locked source rows.
-- A request authorised before a revoke completes either finishes first or is
-- refused, never writes after a completed revocation using an earlier lookup.
-- service_role deliberately cannot read auth.users. This single-purpose
-- helper is private, returns only a boolean, and grants no table access.
create schema if not exists saygday_private;
revoke all on schema saygday_private from public,anon,authenticated;
grant usage on schema saygday_private to service_role;
create function saygday_private.integration_active_owner(p_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare u jsonb;
begin
  -- Normal callers are service_role with no user JWT. An unexpected user
  -- claim must never allow this helper to check another person's account.
  if auth.uid() is not null and auth.uid() <> p_user then return false; end if;
  select to_jsonb(a) into u from auth.users a where a.id=p_user for share;
  return found and u->>'email_confirmed_at' is not null and u->>'deleted_at' is null
    and coalesce((u->>'banned_until')::timestamptz,'-infinity'::timestamptz)<=now();
end;
$$;
revoke all on function saygday_private.integration_active_owner(uuid) from public,anon,authenticated;
grant execute on function saygday_private.integration_active_owner(uuid) to service_role;

create function public.integration_execute(p_token_hash text, p_action text, p_params jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare g public.integration_grants; b public.businesses; variants text[];
begin
  select * into g from public.integration_grants where token_hash=p_token_hash for update;
  if not found or g.revoked_at is not null or g.expires_at <= now() then return null; end if;
  if p_action='revoke' then
    update public.integration_grants set revoked_at=now() where id=g.id;
    return jsonb_build_object('revoked',true);
  end if;
  select * into b from public.businesses where id=g.business_id and owner_id=g.owner_id for share;
  if not found or b.website<>g.website or b.website_verified_at is null then return null; end if;
  if not saygday_private.integration_active_owner(g.owner_id) then return null; end if;
  case p_action
    when 'summary' then return jsonb_build_object('business',public.business_json(b),'expiresAt',g.expires_at);
    when 'listFaqs' then return jsonb_build_object('faqs',public.list_faqs(g.owner_id,g.business_id));
    when 'saveFaq' then
      if jsonb_typeof(p_params->'variants')='array' then select array_agg(value) into variants from jsonb_array_elements_text(p_params->'variants'); end if;
      return jsonb_build_object('faq',public.save_faq(p_user=>g.owner_id,p_business=>g.business_id,
        p_id=>(p_params->>'id')::uuid,p_question=>p_params->>'question',p_answer=>p_params->>'answer',p_variants=>variants,
        p_status=>p_params->>'status',p_featured=>(p_params->>'featured')::boolean,p_source=>'owner'));
    when 'listEnquiries' then return public.enquiries_page(p_user=>g.owner_id,p_business=>g.business_id,
      p_status=>p_params->>'status',p_limit=>50,p_before=>(p_params->>'before')::timestamptz,p_before_id=>(p_params->>'beforeId')::uuid);
    when 'setEnquiry' then return jsonb_build_object('updated',public.set_enquiry(p_user=>g.owner_id,p_business=>g.business_id,p_id=>(p_params->>'id')::uuid,p_status=>p_params->>'status'));
    else raise exception 'INVALID_STATUS' using errcode='22023';
  end case;
end;
$$;

revoke all on function public.integration_authorize(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.integration_exchange(text,text,text,text) from public,anon,authenticated;
revoke all on function public.integration_resolve(text) from public,anon,authenticated;
revoke all on function public.integration_list(uuid,uuid) from public,anon,authenticated;
revoke all on function public.integration_revoke(uuid,uuid) from public,anon,authenticated;
grant execute on function public.integration_authorize(uuid,uuid,text,text,text) to service_role;
grant execute on function public.integration_exchange(text,text,text,text) to service_role;
grant execute on function public.integration_resolve(text) to service_role;
grant execute on function public.integration_list(uuid,uuid) to service_role;
grant execute on function public.integration_revoke(uuid,uuid) to service_role;
revoke all on function public.integration_execute(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.integration_execute(text,text,jsonb) to service_role;
