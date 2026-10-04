-- One sign-in, many businesses (owner, 4 October 2026: "it's important that
-- hello@oo.studio has the ability to manage and add many different profiles
-- — I'll use this as a feature when building websites for new clients").
--
-- Until now a business WAS its owner: businesses.owner_id was unique, and
-- every owner function found "the business" from the signed-in user alone.
-- A studio that builds websites for its clients needs one sign-in that holds
-- each client's chat. So the one-per-owner constraint goes, and every owner
-- function takes the business it is for (p_business) beside the verified
-- user, checking that the user owns it:
--   · a sign-in with ONE business still works without naming it (p_business
--     null means the only business), so nothing already built changes;
--   · a sign-in with SEVERAL must name one (CHOOSE_BUSINESS otherwise), so
--     two dashboard tabs on two businesses can never edit each other.
-- p_user stays first on every function: the browser never picks whose data
-- it reads (the hard rule); it can only name one of its own businesses.
-- create_business asked twice for the SAME website still returns the
-- business it has (the owner's double-tap rule); a different website is
-- another business under the same sign-in.

-- The constraint by lookup rather than by name: the live database and a
-- test database may have named it differently.
do $$
declare c record;
begin
  for c in
    select con.conname from pg_constraint con
    where con.conrelid = 'public.businesses'::regclass and con.contype = 'u'
      and con.conkey = array[(select attnum from pg_attribute where attrelid = 'public.businesses'::regclass and attname = 'owner_id')]
  loop
    execute format('alter table public.businesses drop constraint %I', c.conname);
  end loop;
end $$;
create index if not exists businesses_owner_id_idx on public.businesses(owner_id);

-- The old one-argument shapes go first: a defaulted second argument beside
-- them would make every call ambiguous.
drop function public.owned_business(uuid);
drop function public.my_business(uuid);
drop function public.latest_scan(uuid);
drop function public.start_scan(uuid, text);
drop function public.list_faqs(uuid);
drop function public.save_faq(uuid, uuid, text, text, text[], text, boolean, text);
drop function public.delete_faq(uuid, uuid);
drop function public.approve_all(uuid);
drop function public.update_business(uuid, text, text, text, text);
drop function public.set_signed_by(uuid, text);
drop function public.list_enquiries(uuid);
drop function public.enquiries_page(uuid, text, integer, timestamptz, uuid);
drop function public.set_enquiry(uuid, uuid, text);
drop function public.delete_enquiry(uuid, uuid);

-- The one place a request's business is resolved and checked.
create function public.owned_business(p_user uuid, p_business uuid default null)
returns public.businesses language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses; n integer;
begin
  if p_user is null then raise exception 'AUTH_REQUIRED' using errcode = '22023'; end if;
  if p_business is not null then
    -- Someone else's business and no business read the same: nothing to learn.
    select * into v from public.businesses where id = p_business and owner_id = p_user;
    if not found then raise exception 'NO_BUSINESS' using errcode = 'P0002'; end if;
    return v;
  end if;
  select count(*) into n from public.businesses where owner_id = p_user;
  if n = 0 then raise exception 'NO_BUSINESS' using errcode = 'P0002'; end if;
  if n > 1 then raise exception 'CHOOSE_BUSINESS' using errcode = 'P0002'; end if;
  select * into v from public.businesses where owner_id = p_user;
  return v;
end;
$$;

-- What the dashboard knows about a business, in one place: my_business and
-- my_businesses hand out the same shape.
create function public.business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'greeting', b.greeting, 'signedBy', b.signed_by, 'buttonSeenAt', b.button_seen_at, 'createdAt', b.created_at,
    'websiteVerifiedAt', b.website_verified_at, 'verifiedBy', b.verified_by, 'verificationToken', b.verification_token,
    'counts', jsonb_build_object(
      'approved', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'approved'),
      'drafts', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'draft'),
      'featured', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'approved' and f.featured),
      'newEnquiries', (select count(*) from public.enquiries e where e.business_id = b.id and e.status = 'new'),
      'views', (select coalesce(sum(f.views), 0) from public.faqs f where f.business_id = b.id)
    )
  )
$$;

-- Null while the person has no business yet (the first screen); otherwise
-- the named business, or the only one.
create function public.my_business(p_user uuid, p_business uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_business is null and not exists (select 1 from public.businesses where owner_id = p_user) then return null; end if;
  return public.business_json(public.owned_business(p_user, p_business));
end;
$$;

-- Every business the sign-in holds, oldest first: the dashboard's switcher.
create function public.my_businesses(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_agg(public.business_json(b) order by b.created_at, b.id) from public.businesses b where b.owner_id = p_user), '[]'::jsonb)
$$;

create or replace function public.create_business(p_user uuid, p_email text, p_website text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_website text := public.clean_website(p_website);
  v_host text := regexp_replace(regexp_replace(v_website, '^https://', ''), '^www\.', '');
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_base text;
  v_slug text;
  v_try integer := 0;
  v public.businesses;
begin
  if p_user is null then raise exception 'AUTH_REQUIRED' using errcode = '22023'; end if;
  -- The same website asked for twice (a double tap, a reload mid-request) is
  -- the business it already has. A different website is another business.
  select * into v from public.businesses where owner_id = p_user and website = v_website order by created_at limit 1;
  if found then return public.business_json(v); end if;
  if v_name is null then
    -- "joes-cafe.com.au" becomes "Joes Cafe" until the owner names it.
    v_name := initcap(replace(split_part(v_host, '.', 1), '-', ' '));
  end if;
  v_name := left(v_name, 120);
  v_base := left(trim(both '-' from regexp_replace(lower(split_part(v_host, '.', 1)), '[^a-z0-9]+', '-', 'g')), 40);
  if char_length(v_base) < 3 then v_base := 'business'; end if;
  v_slug := v_base;
  while exists (select 1 from public.businesses where slug = v_slug) loop
    v_try := v_try + 1;
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
    if v_try > 20 then raise exception 'SLUG_UNAVAILABLE' using errcode = 'P0001'; end if;
  end loop;
  insert into public.businesses(owner_id, slug, name, website, notify_email)
  values (p_user, v_slug, v_name, v_website, lower(btrim(p_email)))
  returning * into v;
  return public.business_json(v);
end;
$$;

create function public.latest_scan(p_user uuid, p_business uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business); s public.scans;
begin
  select * into s from public.scans where business_id = v.id order by created_at desc limit 1;
  if not found then return null; end if;
  if s.status in ('queued','reading') and s.updated_at < now() - interval '15 minutes' then
    s.status := 'failed'; s.error := 'Reading your website took too long. Please try again.';
  end if;
  return public.scan_json(s);
end;
$$;

create function public.start_scan(p_user uuid, p_website text, p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business); v_website text := public.clean_website(p_website); s public.scans;
begin
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

create function public.list_faqs(p_user uuid, p_business uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  return coalesce((select jsonb_agg(public.faq_json(f) order by f.status = 'approved', f.position, f.created_at)
    from public.faqs f where f.business_id = v.id), '[]'::jsonb);
end;
$$;

create function public.save_faq(p_user uuid, p_id uuid, p_question text, p_answer text, p_variants text[] default null,
  p_status text default null, p_featured boolean default null, p_source text default 'owner', p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.businesses := public.owned_business(p_user, p_business);
  v_row public.faqs;
  v_question text := btrim(regexp_replace(coalesce(p_question, ''), '\s+', ' ', 'g'));
  v_answer text := btrim(coalesce(p_answer, ''));
begin
  if p_status is not null and p_status not in ('draft','approved') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  if p_id is null then
    if p_source not in ('owner','enquiry') then raise exception 'INVALID_SOURCE' using errcode = '22023'; end if;
    if (select count(*) from public.faqs where business_id = v.id) >= 200 then raise exception 'FAQ_LIMIT' using errcode = 'P0001'; end if;
    insert into public.faqs(business_id, question, answer, variants, status, featured, source, position)
    values (v.id, v_question, v_answer, public.clean_variants(p_variants, v_question), coalesce(p_status, 'approved'), false, p_source,
      coalesce((select max(position) + 1 from public.faqs where business_id = v.id), 0))
    returning * into v_row;
  else
    update public.faqs set
      question = case when p_question is null then question else v_question end,
      answer = case when p_answer is null then answer else v_answer end,
      variants = case when p_variants is null then variants else public.clean_variants(p_variants, coalesce(nullif(v_question, ''), question)) end,
      status = coalesce(p_status, status),
      updated_at = now()
    where id = p_id and business_id = v.id
    returning * into v_row;
    if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  -- A draft is never featured; featuring needs room among the six.
  if v_row.status = 'draft' and v_row.featured then
    update public.faqs set featured = false where id = v_row.id returning * into v_row;
  end if;
  if p_featured is not null and p_featured <> v_row.featured then
    if p_featured and v_row.status <> 'approved' then raise exception 'FEATURE_NEEDS_APPROVAL' using errcode = 'P0001'; end if;
    if p_featured and (select count(*) from public.faqs where business_id = v.id and featured) >= 6 then raise exception 'FEATURED_LIMIT' using errcode = 'P0001'; end if;
    update public.faqs set featured = p_featured, updated_at = now() where id = v_row.id returning * into v_row;
  end if;
  return public.faq_json(v_row);
end;
$$;

create function public.delete_faq(p_user uuid, p_id uuid, p_business uuid default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  delete from public.faqs where id = p_id and business_id = v.id;
  return found;
end;
$$;

create function public.approve_all(p_user uuid, p_business uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business); v_count integer;
begin
  update public.faqs set status = 'approved', updated_at = now() where business_id = v.id and status = 'draft';
  get diagnostics v_count = row_count;
  -- A business with no featured answers yet gets its first six as buttons.
  if not exists (select 1 from public.faqs where business_id = v.id and featured) then
    update public.faqs set featured = true where id in (
      select id from public.faqs where business_id = v.id and status = 'approved' order by position, created_at limit 6);
  end if;
  return v_count;
end;
$$;

create function public.update_business(p_user uuid, p_name text default null, p_notify_email text default null, p_character text default null, p_greeting text default null, p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  update public.businesses set
    name = coalesce(nullif(btrim(regexp_replace(p_name, '\s+', ' ', 'g')), ''), name),
    notify_email = coalesce(nullif(lower(btrim(p_notify_email)), ''), notify_email),
    character = coalesce(p_character, character),
    greeting = coalesce(nullif(btrim(p_greeting), ''), greeting),
    updated_at = now()
  where id = v.id
  returning * into v;
  return public.business_json(v);
end;
$$;

create function public.set_signed_by(p_user uuid, p_signed_by text, p_business uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  update public.businesses set
    signed_by = nullif(btrim(regexp_replace(coalesce(p_signed_by, ''), '\s+', ' ', 'g')), ''),
    updated_at = now()
  where id = v.id
  returning * into v;
  return public.business_json(v);
end;
$$;

create function public.list_enquiries(p_user uuid, p_business uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'question', e.question, 'email', e.email, 'status', e.status,
      'emailed', e.emailed_at is not null, 'createdAt', e.created_at) order by e.created_at desc)
    from (select * from public.enquiries where business_id = v.id order by created_at desc limit 300) e), '[]'::jsonb);
end;
$$;

create function public.enquiries_page(p_user uuid, p_status text default 'new', p_limit integer default 50,
  p_before timestamptz default null, p_before_id uuid default null, p_business uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user, p_business); rows jsonb; cursor jsonb; n integer;
begin
  if p_status is null or p_status not in ('new','done') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before is null) <> (p_before_id is null) then
    raise exception 'INVALID_PAGE' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'question', e.question, 'email', e.email, 'status', e.status,
    'emailed', e.emailed_at is not null, 'createdAt', e.created_at,
    'notification', case when e.email is null then 'not_requested' when e.emailed_at is not null then 'sent'
      when q.status = 'sending' then 'pending' else coalesce(q.status, 'not_queued') end)
    order by e.created_at desc, e.id desc), '[]'::jsonb) into rows
    from (select * from public.enquiries where business_id = b.id and status = p_status
      and (p_before is null or (created_at, id) < (p_before, p_before_id))
      order by created_at desc, id desc limit p_limit + 1) e
    left join public.enquiry_notifications q on q.enquiry_id = e.id;
  n := jsonb_array_length(rows);
  if n > p_limit then
    rows := rows - p_limit;
    cursor := jsonb_build_object('createdAt', rows->(p_limit-1)->>'createdAt', 'id', rows->(p_limit-1)->>'id');
  end if;
  return jsonb_build_object('enquiries', rows, 'nextCursor', cursor, 'counts', jsonb_build_object(
    'new', (select count(*) from public.enquiries where business_id = b.id and status = 'new'),
    'done', (select count(*) from public.enquiries where business_id = b.id and status = 'done')));
end;
$$;

create function public.set_enquiry(p_user uuid, p_id uuid, p_status text, p_business uuid default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  if p_status not in ('new','done') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  update public.enquiries set status = p_status where id = p_id and business_id = v.id;
  return found;
end;
$$;

create function public.delete_enquiry(p_user uuid, p_id uuid, p_business uuid default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  delete from public.enquiries where id = p_id and business_id = v.id;
  return found;
end;
$$;

-- The browser never calls a function: everything here is the server's only.
revoke all on function public.owned_business(uuid, uuid) from public, anon, authenticated;
revoke all on function public.business_json(public.businesses) from public, anon, authenticated;
revoke all on function public.my_business(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_businesses(uuid) from public, anon, authenticated;
revoke all on function public.create_business(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.latest_scan(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_scan(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_faqs(uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_faq(uuid, uuid, text, text, text[], text, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.delete_faq(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.approve_all(uuid, uuid) from public, anon, authenticated;
revoke all on function public.update_business(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.set_signed_by(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_enquiries(uuid, uuid) from public, anon, authenticated;
revoke all on function public.enquiries_page(uuid, text, integer, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_enquiry(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.delete_enquiry(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.owned_business(uuid, uuid) to service_role;
grant execute on function public.business_json(public.businesses) to service_role;
grant execute on function public.my_business(uuid, uuid) to service_role;
grant execute on function public.my_businesses(uuid) to service_role;
grant execute on function public.create_business(uuid, text, text, text) to service_role;
grant execute on function public.latest_scan(uuid, uuid) to service_role;
grant execute on function public.start_scan(uuid, text, uuid) to service_role;
grant execute on function public.list_faqs(uuid, uuid) to service_role;
grant execute on function public.save_faq(uuid, uuid, text, text, text[], text, boolean, text, uuid) to service_role;
grant execute on function public.delete_faq(uuid, uuid, uuid) to service_role;
grant execute on function public.approve_all(uuid, uuid) to service_role;
grant execute on function public.update_business(uuid, text, text, text, text, uuid) to service_role;
grant execute on function public.set_signed_by(uuid, text, uuid) to service_role;
grant execute on function public.list_enquiries(uuid, uuid) to service_role;
grant execute on function public.enquiries_page(uuid, text, integer, timestamptz, uuid, uuid) to service_role;
grant execute on function public.set_enquiry(uuid, uuid, text, uuid) to service_role;
grant execute on function public.delete_enquiry(uuid, uuid, uuid) to service_role;
