-- A business proves it owns its website before its chat goes live (owner,
-- 3 October 2026: "Somebody has to prove they own the website before they put
-- the code into it"). Two ways, checked by the server
-- (netlify/functions/_lib/verify-website.mjs):
--   * the button: the website's home page carries this business's own chat
--     button code, which only someone who can edit the website could put there;
--   * DNS: a TXT record "saygday-verification=<token>" on the website's domain.
-- Until then the chat serves nothing: no answers, no questions taken, no
-- "seen on your website". Changing the website starts again, and a website can
-- be verified by one business only.
begin;

alter table public.businesses
  add column verification_token text not null default replace(gen_random_uuid()::text, '-', '')
    check (verification_token ~ '^[0-9a-f]{32}$'),
  add column website_verified_at timestamptz,
  add column verified_by text check (verified_by is null or verified_by in ('button', 'dns'));

-- One verified business per website, with or without www.
create unique index businesses_verified_website_idx
  on public.businesses (regexp_replace(regexp_replace(website, '^https://', ''), '^www\.', ''))
  where website_verified_at is not null;

-- A different website is a new claim (www or not is the same website).
create function public.website_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if regexp_replace(regexp_replace(coalesce(new.website, ''), '^https://', ''), '^www\.', '')
     is distinct from regexp_replace(regexp_replace(coalesce(old.website, ''), '^https://', ''), '^www\.', '') then
    new.website_verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end;
$$;
create trigger businesses_website_changed before update of website on public.businesses
  for each row execute function public.website_changed();

create or replace function public.my_business(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when b.id is null then null else jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'greeting', b.greeting, 'buttonSeenAt', b.button_seen_at, 'createdAt', b.created_at,
    'websiteVerifiedAt', b.website_verified_at, 'verifiedBy', b.verified_by, 'verificationToken', b.verification_token,
    'counts', jsonb_build_object(
      'approved', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'approved'),
      'drafts', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'draft'),
      'featured', (select count(*) from public.faqs f where f.business_id = b.id and f.status = 'approved' and f.featured),
      'newEnquiries', (select count(*) from public.enquiries e where e.business_id = b.id and e.status = 'new'),
      'views', (select coalesce(sum(f.views), 0) from public.faqs f where f.business_id = b.id)
    )
  ) end
  from (select 1) one left join public.businesses b on b.owner_id = p_user
$$;

-- What the server needs to check a business that isn't verified yet.
create function public.verification_target(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'website', b.website, 'verificationToken', b.verification_token)
  from public.businesses b where b.slug = p_slug and b.website is not null and b.website_verified_at is null
$$;

-- The server found the proof on p_website. Nothing changes if the website has
-- changed since the check began, or another business has verified it.
create function public.mark_website_verified(p_slug text, p_website text, p_method text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare b public.businesses;
begin
  if p_method is null or p_method not in ('button', 'dns') then raise exception 'INVALID_METHOD' using errcode = '22023'; end if;
  select * into b from public.businesses where slug = p_slug for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if b.website is distinct from p_website then raise exception 'WEBSITE_CHANGED' using errcode = 'P0001'; end if;
  if b.website_verified_at is not null then return true; end if;
  begin
    update public.businesses set website_verified_at = now(), verified_by = p_method, updated_at = now() where id = b.id;
  exception when unique_violation then
    raise exception 'WEBSITE_TAKEN' using errcode = 'P0001';
  end;
  return true;
end;
$$;

-- The chat's own website, once verified: where its button and window may run.
create function public.chat_website(p_slug text)
returns text language sql stable security invoker set search_path = '' as $$
  select b.website from public.businesses b where b.slug = p_slug and b.website_verified_at is not null
$$;

-- ---- The chat button: verified websites only ----------------------------------

create or replace function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'greeting', b.greeting, 'website', b.website,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug and b.website_verified_at is not null
$$;

create or replace function public.button_seen(p_slug text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.businesses set button_seen_at = now()
    where slug = p_slug and website_verified_at is not null and (button_seen_at is null or button_seen_at < now() - interval '1 hour');
  return found;
end;
$$;

create or replace function public.faq_viewed(p_slug text, p_faq uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.faqs f set views = f.views + 1 from public.businesses b
    where b.slug = p_slug and b.website_verified_at is not null and f.business_id = b.id and f.id = p_faq and f.status = 'approved';
  return found;
end;
$$;

create or replace function public.ask_team(p_slug text, p_question text, p_email text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; e public.enquiries;
begin
  select * into b from public.businesses where slug = p_slug and website_verified_at is not null;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.enquiries(business_id, question, email)
  values (b.id, left(btrim(regexp_replace(p_question, '\s+', ' ', 'g')), 500), nullif(lower(btrim(coalesce(p_email, ''))), ''))
  returning * into e;
  return jsonb_build_object('id', e.id, 'businessName', b.name, 'notifyEmail', b.notify_email, 'question', e.question, 'email', e.email, 'createdAt', e.created_at);
end;
$$;

-- ---- Only the server may call any of it ------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('website_changed','my_business','verification_target','mark_website_verified','chat_website',
      'widget','button_seen','faq_viewed','ask_team')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
