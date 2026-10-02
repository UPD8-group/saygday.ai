-- SayGday: an interactive FAQ for small business websites (2 October 2026).
--
-- The owner's brief: a business signs up with an email code, enters its web
-- address, and we scan the website once to draft 20 to 25 questions and
-- answers. The business manages them in its dashboard. The chat button on its
-- website answers ONLY with answers the owner approved, word for word. Nothing
-- answers visitors with AI, so nothing can be made up. A question it can't
-- answer is passed to the business by email.
--
-- Every table is closed to the browser. The browser signs in with Supabase
-- Auth and talks only to the site's own functions, which verify the person
-- and call the functions below as the service role. Each owner function takes
-- the verified user id and only ever touches that user's own business.
begin;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  website text check (website is null or (char_length(website) <= 300 and website ~ '^https://[^/\s]+$')),
  notify_email text not null check (char_length(notify_email) between 3 and 254 and notify_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  character text not null default 'bubble' check (character in ('bubble','skippy','quigley','eddie','kiki','kip','penny','sully','wally')),
  greeting text not null default 'G''day! Here are some things people often ask.' check (char_length(btrim(greeting)) between 1 and 200),
  button_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 3 and 200),
  answer text not null check (char_length(btrim(answer)) between 1 and 1500),
  -- Other ways a customer might ask the same thing. They help the chat find
  -- this answer without AI; they are never shown as an answer.
  variants text[] not null default '{}' check (cardinality(variants) <= 12),
  status text not null default 'draft' check (status in ('draft','approved')),
  -- Shown as a button when the chat opens (at most six per business).
  featured boolean not null default false,
  source text not null default 'owner' check (source in ('scan','owner','enquiry')),
  source_url text check (source_url is null or char_length(source_url) <= 500),
  position integer not null default 0,
  views integer not null default 0 check (views >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index faqs_business_question_idx on public.faqs(business_id, lower(btrim(question)));
create index faqs_business_idx on public.faqs(business_id, status, position);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  website text not null check (char_length(website) <= 300 and website ~ '^https://[^/\s]+$'),
  status text not null default 'queued' check (status in ('queued','reading','done','failed')),
  stage text check (stage is null or char_length(stage) <= 120),
  pages integer check (pages is null or pages between 0 and 100),
  drafted integer check (drafted is null or drafted between 0 and 200),
  error text check (error is null or char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index scans_business_idx on public.scans(business_id, created_at desc);

-- What visitors asked that the chat couldn't answer. With an email, the
-- business is told and can reply; without one, it still shows in the
-- dashboard so the owner can add an answer for next time.
create table public.enquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 1 and 500),
  email text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  status text not null default 'new' check (status in ('new','done')),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index enquiries_business_idx on public.enquiries(business_id, created_at desc);

create table public.rate_limits (
  key text primary key check (char_length(key) between 1 and 300),
  window_started_at timestamptz not null default now(),
  requests integer not null default 0 check (requests >= 0)
);

do $$
declare t text;
begin
  foreach t in array array['businesses','faqs','scans','enquiries','rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ---- Helpers ---------------------------------------------------------------

create function public.rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_allowed boolean;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_limit > 1000000 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;
  insert into public.rate_limits(key, window_started_at, requests) values (p_key, clock_timestamp(), 1)
  on conflict (key) do update set
    requests = case when public.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then 1 else public.rate_limits.requests + 1 end,
    window_started_at = case when public.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp() else public.rate_limits.window_started_at end
  where public.rate_limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds)
    or public.rate_limits.requests < p_limit
  returning true into v_allowed;
  return coalesce(v_allowed, false);
end;
$$;

-- The owner's business, or an error the server turns into "set up first".
create function public.owned_business(p_user uuid)
returns public.businesses language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses;
begin
  select * into v from public.businesses where owner_id = p_user;
  if not found then raise exception 'NO_BUSINESS' using errcode = 'P0002'; end if;
  return v;
end;
$$;

-- Variants: trimmed, 3 to 200 characters, no duplicates, at most twelve.
create function public.clean_variants(p_variants text[], p_question text)
returns text[] language plpgsql immutable set search_path = '' as $$
declare v_out text[] := '{}'; v text; x text;
begin
  foreach x in array coalesce(p_variants, '{}'::text[]) loop
    v := btrim(regexp_replace(coalesce(x, ''), '\s+', ' ', 'g'));
    continue when char_length(v) not between 3 and 200;
    continue when lower(v) = lower(btrim(coalesce(p_question, '')));
    continue when exists (select 1 from unnest(v_out) o where lower(o) = lower(v));
    v_out := v_out || v;
    exit when cardinality(v_out) >= 12;
  end loop;
  return v_out;
end;
$$;

-- A web address the scan may read: https, a host, nothing else.
create function public.clean_website(p_website text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := lower(btrim(coalesce(p_website, '')));
begin
  v := regexp_replace(v, '/+$', '');
  if v !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' or char_length(v) > 300 then
    raise exception 'INVALID_WEBSITE' using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---- The owner's business ---------------------------------------------------

create function public.my_business(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when b.id is null then null else jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'greeting', b.greeting, 'buttonSeenAt', b.button_seen_at, 'createdAt', b.created_at,
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

-- One business per account. Calling it again returns the same business.
create function public.create_business(p_user uuid, p_email text, p_website text, p_name text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_website text := public.clean_website(p_website);
  v_host text := regexp_replace(regexp_replace(v_website, '^https://', ''), '^www\.', '');
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_base text;
  v_slug text;
  v_try integer := 0;
begin
  if p_user is null then raise exception 'AUTH_REQUIRED' using errcode = '22023'; end if;
  if exists (select 1 from public.businesses where owner_id = p_user) then return public.my_business(p_user); end if;
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
  values (p_user, v_slug, v_name, v_website, lower(btrim(p_email)));
  return public.my_business(p_user);
end;
$$;

create function public.update_business(p_user uuid, p_name text default null, p_notify_email text default null, p_character text default null, p_greeting text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  update public.businesses set
    name = coalesce(nullif(btrim(regexp_replace(p_name, '\s+', ' ', 'g')), ''), name),
    notify_email = coalesce(nullif(lower(btrim(p_notify_email)), ''), notify_email),
    character = coalesce(p_character, character),
    greeting = coalesce(nullif(btrim(p_greeting), ''), greeting),
    updated_at = now()
  where id = v.id;
  return public.my_business(p_user);
end;
$$;

-- ---- Questions and answers ----------------------------------------------------

create function public.faq_json(f public.faqs)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants),
    'status', f.status, 'featured', f.featured, 'source', f.source, 'sourceUrl', f.source_url, 'position', f.position,
    'views', f.views, 'createdAt', f.created_at, 'updatedAt', f.updated_at)
$$;

create function public.list_faqs(p_user uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  return coalesce((select jsonb_agg(public.faq_json(f) order by f.status = 'approved', f.position, f.created_at)
    from public.faqs f where f.business_id = v.id), '[]'::jsonb);
end;
$$;

-- Adds (p_id null) or changes one question and answer. At most 200 per
-- business; at most six featured, and only approved ones can be featured.
create function public.save_faq(p_user uuid, p_id uuid, p_question text, p_answer text, p_variants text[] default null,
  p_status text default null, p_featured boolean default null, p_source text default 'owner')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v public.businesses := public.owned_business(p_user);
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

create function public.delete_faq(p_user uuid, p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  delete from public.faqs where id = p_id and business_id = v.id;
  return found;
end;
$$;

create function public.approve_all(p_user uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user); v_count integer;
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

-- ---- The website scan ---------------------------------------------------------

create function public.scan_json(s public.scans)
returns jsonb language sql immutable set search_path = '' as $$
  select case when s.id is null then null else jsonb_build_object('id', s.id, 'website', s.website, 'status', s.status, 'stage', s.stage,
    'pages', s.pages, 'drafted', s.drafted, 'error', s.error, 'createdAt', s.created_at, 'updatedAt', s.updated_at, 'finishedAt', s.finished_at) end
$$;

-- A scan still marked queued or reading after 15 minutes has died with its
-- function: it reads as failed and a new one may start.
create function public.latest_scan(p_user uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user); s public.scans;
begin
  select * into s from public.scans where business_id = v.id order by created_at desc limit 1;
  if not found then return null; end if;
  if s.status in ('queued','reading') and s.updated_at < now() - interval '15 minutes' then
    s.status := 'failed'; s.error := 'Reading your website took too long. Please try again.';
  end if;
  return public.scan_json(s);
end;
$$;

-- Starts a scan of p_website (which becomes the business's website), or
-- returns the one already running. Six a day per business: each scan is a
-- paid AI call.
create function public.start_scan(p_user uuid, p_website text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user); v_website text := public.clean_website(p_website); s public.scans;
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

-- The background job takes a queued scan exactly once.
create function public.claim_scan(p_scan uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s public.scans; b public.businesses;
begin
  update public.scans set status = 'reading', stage = 'Finding your pages', updated_at = now()
    where id = p_scan and status = 'queued' returning * into s;
  if not found then return null; end if;
  select * into b from public.businesses where id = s.business_id;
  return jsonb_build_object('scan', public.scan_json(s), 'business', jsonb_build_object('id', b.id, 'name', b.name, 'website', b.website));
end;
$$;

create function public.scan_stage(p_scan uuid, p_stage text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.scans set stage = left(p_stage, 120), updated_at = now() where id = p_scan and status = 'reading';
  return found;
end;
$$;

create function public.fail_scan(p_scan uuid, p_error text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.scans set status = 'failed', stage = 'Stopped', error = left(coalesce(p_error, 'We couldn’t finish reading your website.'), 500),
    updated_at = now(), finished_at = now()
  where id = p_scan and status in ('queued','reading');
  return found;
end;
$$;

-- Saves the drafts a scan found. A re-scan replaces the previous scan's
-- drafts the owner never touched; approved answers, the owner's own and any
-- draft the owner edited are never changed. A question the business already
-- has is skipped.
create function public.finish_scan(p_scan uuid, p_entries jsonb, p_pages integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  s public.scans;
  v_entry jsonb;
  v_question text;
  v_answer text;
  v_count integer := 0;
  v_position integer;
  v_total integer;
begin
  select * into s from public.scans where id = p_scan and status = 'reading' for update;
  if not found then return null; end if;
  if jsonb_typeof(p_entries) <> 'array' then raise exception 'INVALID_ENTRIES' using errcode = '22023'; end if;
  if s.website is distinct from (select website from public.businesses where id = s.business_id) then
    update public.scans set status = 'failed', stage = 'Stopped', error = 'Your website address changed while we were reading it.', updated_at = now(), finished_at = now() where id = s.id;
    return null;
  end if;
  delete from public.faqs where business_id = s.business_id and source = 'scan' and status = 'draft' and updated_at = created_at;
  select coalesce(max(position) + 1, 0), count(*) into v_position, v_total from public.faqs where business_id = s.business_id;
  for v_entry in select value from jsonb_array_elements(p_entries) limit 30 loop
    exit when v_total + v_count >= 200;
    v_question := btrim(regexp_replace(coalesce(v_entry->>'question', ''), '\s+', ' ', 'g'));
    v_answer := btrim(coalesce(v_entry->>'answer', ''));
    continue when char_length(v_question) not between 3 and 200 or char_length(v_answer) not between 1 and 1500;
    continue when exists (select 1 from public.faqs where business_id = s.business_id and lower(btrim(question)) = lower(v_question));
    insert into public.faqs(business_id, question, answer, variants, status, source, source_url, position)
    values (s.business_id, v_question, v_answer,
      public.clean_variants(array(select jsonb_array_elements_text(case when jsonb_typeof(v_entry->'variants') = 'array' then v_entry->'variants' else '[]'::jsonb end)), v_question),
      'draft', 'scan', left(nullif(v_entry->>'source_url', ''), 500), v_position + v_count);
    v_count := v_count + 1;
  end loop;
  update public.scans set status = 'done', stage = 'Done', pages = p_pages, drafted = v_count, updated_at = now(), finished_at = now() where id = s.id;
  return v_count;
end;
$$;

-- ---- The chat button on the business's website (public) -------------------------

-- What the chat shows: the business's name, look and approved answers only.
create function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'greeting', b.greeting,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug
$$;

-- The launcher says it was seen on the website (at most once an hour).
create function public.button_seen(p_slug text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.businesses set button_seen_at = now() where slug = p_slug and (button_seen_at is null or button_seen_at < now() - interval '1 hour');
  return found;
end;
$$;

create function public.faq_viewed(p_slug text, p_faq uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.faqs f set views = f.views + 1 from public.businesses b
    where b.slug = p_slug and f.business_id = b.id and f.id = p_faq and f.status = 'approved';
  return found;
end;
$$;

-- A question the chat couldn't answer, with the visitor's email if they left
-- one. Returns what the server needs to tell the business.
create function public.ask_team(p_slug text, p_question text, p_email text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses; e public.enquiries;
begin
  select * into b from public.businesses where slug = p_slug;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.enquiries(business_id, question, email)
  values (b.id, left(btrim(regexp_replace(p_question, '\s+', ' ', 'g')), 500), nullif(lower(btrim(coalesce(p_email, ''))), ''))
  returning * into e;
  return jsonb_build_object('id', e.id, 'businessName', b.name, 'notifyEmail', b.notify_email, 'question', e.question, 'email', e.email, 'createdAt', e.created_at);
end;
$$;

create function public.enquiry_emailed(p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.enquiries set emailed_at = now() where id = p_id and emailed_at is null;
  return found;
end;
$$;

-- ---- What customers asked (the owner's inbox) -----------------------------------

create function public.list_enquiries(p_user uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'question', e.question, 'email', e.email, 'status', e.status,
      'emailed', e.emailed_at is not null, 'createdAt', e.created_at) order by e.created_at desc)
    from (select * from public.enquiries where business_id = v.id order by created_at desc limit 300) e), '[]'::jsonb);
end;
$$;

create function public.set_enquiry(p_user uuid, p_id uuid, p_status text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  if p_status not in ('new','done') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  update public.enquiries set status = p_status where id = p_id and business_id = v.id;
  return found;
end;
$$;

create function public.delete_enquiry(p_user uuid, p_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  delete from public.enquiries where id = p_id and business_id = v.id;
  return found;
end;
$$;

-- ---- Only the server may call any of it ------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('rate_limit','owned_business','clean_variants','clean_website','my_business','create_business',
      'update_business','faq_json','list_faqs','save_faq','delete_faq','approve_all','scan_json','latest_scan','start_scan','claim_scan',
      'scan_stage','fail_scan','finish_scan','widget','button_seen','faq_viewed','ask_team','enquiry_emailed','list_enquiries','set_enquiry','delete_enquiry')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
