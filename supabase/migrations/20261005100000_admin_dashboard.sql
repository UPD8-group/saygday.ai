-- SayGday's own admin page (owner, 5 October 2026: "I don't have an admin
-- dashboard for the platform so I'm unable to see how many businesses have
-- actually signed up. I'm unable to see where they might be up to in the
-- 14-day free trial… add extra that you feel would be needed in order to
-- provide insights into future VCs").
--
-- The page (/admin) sits behind a password the server checks
-- (SAYGDAY_ADMIN_PASSWORD, netlify/functions/_lib/admin.mjs). Like everything
-- else, every function here is the server's only. Three additions:
--   · a business's plan, set by hand from the admin page while billing is by
--     hand: trial (the default; the free 14 days run from when the website
--     was added), paying, cancelled, or internal (SayGday's own and test
--     businesses, left out of every count). Each change is kept, so paying
--     businesses can be counted month by month.
--   · how much each chat is used, day by day (Canberra's calendar): how many
--     answers were opened, and in how many hours the button loaded on the
--     website. Counts only: the same counts the server already keeps, by day
--     (the privacy page: "We only count how often each answer is opened, not
--     who opened it"). Nothing about a visitor is recorded.
--   · summaries for the admin page. Customers' questions and email addresses
--     never reach it: it sees when a question came in and whether the email
--     reached the business, never what was asked or who asked.
begin;

-- ---- Plans --------------------------------------------------------------------

alter table public.businesses
  add column plan text not null default 'trial' check (plan in ('trial', 'paying', 'cancelled', 'internal')),
  add column plan_changed_at timestamptz;

create table public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  plan text not null check (plan in ('trial', 'paying', 'cancelled', 'internal')),
  created_at timestamptz not null default now()
);
create index plan_changes_business_idx on public.plan_changes(business_id, created_at desc);

-- ---- Day-by-day use -------------------------------------------------------------

create table public.business_activity (
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  answers_read integer not null default 0 check (answers_read >= 0),
  button_hours integer not null default 0 check (button_hours >= 0),
  primary key (business_id, day)
);
create index business_activity_day_idx on public.business_activity(day);

do $$
declare t text;
begin
  foreach t in array array['plan_changes', 'business_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- Adds to today's row (Canberra keeps Sydney's time).
create function public.count_activity(p_business uuid, p_answers integer, p_hours integer)
returns void language sql security invoker set search_path = '' as $$
  insert into public.business_activity as a (business_id, day, answers_read, button_hours)
  values (p_business, (now() at time zone 'Australia/Sydney')::date, p_answers, p_hours)
  on conflict (business_id, day) do update
    set answers_read = a.answers_read + excluded.answers_read, button_hours = a.button_hours + excluded.button_hours
$$;

-- As before (20261003100000_website_verification.sql), and the day's count.
create or replace function public.faq_viewed(p_slug text, p_faq uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_business uuid;
begin
  update public.faqs f set views = f.views + 1 from public.businesses b
    where b.slug = p_slug and b.website_verified_at is not null and f.business_id = b.id and f.id = p_faq and f.status = 'approved'
    returning f.business_id into v_business;
  if not found then return false; end if;
  perform public.count_activity(v_business, 1, 0);
  return true;
end;
$$;

-- As before (at most once an hour), and the hour counted for the day.
create or replace function public.button_seen(p_slug text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_business uuid;
begin
  update public.businesses set button_seen_at = now()
    where slug = p_slug and website_verified_at is not null and (button_seen_at is null or button_seen_at < now() - interval '1 hour')
    returning id into v_business;
  if not found then return false; end if;
  perform public.count_activity(v_business, 0, 1);
  return true;
end;
$$;

-- ---- The admin page's summaries ---------------------------------------------------

-- A scan still queued or reading after 15 minutes died with its function
-- (latest_scan's rule); one replaced by a newer scan didn't fail.
create function public.admin_scan_state(s public.scans)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when s.status in ('queued', 'reading') and s.updated_at < now() - interval '15 minutes' then 'failed'
    when s.status = 'failed' and s.error = 'Replaced by a newer scan.' then 'replaced'
    else s.status end
$$;

-- One business as the admin page sees it.
create function public.admin_business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'ownerId', b.owner_id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'buttonColour', b.button_colour, 'createdAt', b.created_at,
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

-- Every business, newest first.
create function public.admin_businesses()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(public.admin_business_json(b) order by b.created_at desc, b.id), '[]'::jsonb) from public.businesses b
$$;

-- One business in full: its answers, scans, plan history and the last 60
-- days of use. Its customers' questions are listed by when they came in and
-- whether the email reached the business, never by what was asked or who
-- asked it.
create function public.admin_business(p_business uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses; v_today date := (now() at time zone 'Australia/Sydney')::date;
begin
  select * into b from public.businesses where id = p_business;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'business', public.admin_business_json(b) || jsonb_build_object('greeting', b.greeting, 'signedBy', b.signed_by),
    'otherBusinesses', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'website', o.website, 'plan', o.plan,
        'createdAt', o.created_at) order by o.created_at, o.id)
      from public.businesses o where o.owner_id = b.owner_id and o.id <> b.id), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('plan', p.plan, 'at', p.created_at) order by p.created_at desc, p.id)
      from public.plan_changes p where p.business_id = b.id), '[]'::jsonb),
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'status', f.status,
        'featured', f.featured, 'source', f.source, 'sourceUrl', f.source_url, 'views', f.views, 'createdAt', f.created_at)
        order by f.status = 'draft', f.views desc, f.position, f.created_at)
      from public.faqs f where f.business_id = b.id), '[]'::jsonb),
    'scans', coalesce((select jsonb_agg(jsonb_build_object('status', public.admin_scan_state(s), 'website', s.website, 'pages', s.pages,
        'drafted', s.drafted, 'error', s.error, 'createdAt', s.created_at, 'finishedAt', s.finished_at) order by s.created_at desc, s.id)
      from (select * from public.scans where business_id = b.id order by created_at desc limit 20) s), '[]'::jsonb),
    'enquiries', coalesce((select jsonb_agg(jsonb_build_object('createdAt', e.created_at, 'status', e.status, 'leftEmail', e.email is not null,
        'delivery', case when e.email is null then 'not_requested' when e.emailed_at is not null then 'sent'
          when q.status = 'sending' then 'pending' else coalesce(q.status, 'not_queued') end,
        'failure', q.failure_code) order by e.created_at desc, e.id desc)
      from (select * from public.enquiries where business_id = b.id order by created_at desc, id desc limit 50) e
      left join public.enquiry_notifications q on q.enquiry_id = e.id), '[]'::jsonb),
    'activity', (select jsonb_agg(jsonb_build_object('day', d.day, 'answersRead', coalesce(a.answers_read, 0),
        'buttonHours', coalesce(a.button_hours, 0)) order by d.day)
      from (select v_today - g as day from generate_series(0, 59) g) d
      left join public.business_activity a on a.business_id = b.id and a.day = d.day)
  );
end;
$$;

-- The owner marks a business paying, cancelled, ours, or back to trial.
create function public.admin_set_plan(p_business uuid, p_plan text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare b public.businesses;
begin
  if p_plan is null or p_plan not in ('trial', 'paying', 'cancelled', 'internal') then raise exception 'INVALID_PLAN' using errcode = '22023'; end if;
  select * into b from public.businesses where id = p_business for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if b.plan <> p_plan then
    update public.businesses set plan = p_plan, plan_changed_at = now() where id = b.id returning * into b;
    insert into public.plan_changes(business_id, plan) values (b.id, p_plan);
  end if;
  return public.admin_business_json(b);
end;
$$;

-- Week by week (Monday to Sunday, Canberra time) and month by month, leaving
-- out SayGday's own and test businesses: new businesses, scans, customers'
-- questions, answers read and chats in use, and how many businesses were
-- paying at the end of each month. Emails to businesses over the last 30 days.
create function public.admin_trends(p_weeks integer default 12, p_months integer default 12)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Australia/Sydney')::date;
  v_first date;
  v_since timestamptz;
begin
  if p_weeks is null or p_weeks not between 1 and 104 or p_months is null or p_months not between 1 and 36 then
    raise exception 'INVALID_RANGE' using errcode = '22023';
  end if;
  v_first := date_trunc('week', v_today::timestamp)::date - 7 * (p_weeks - 1);
  v_since := v_first::timestamp at time zone 'Australia/Sydney';
  return jsonb_build_object(
    'today', v_today,
    'trackingSince', (select min(a.day) from public.business_activity a),
    'weeks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'week', w.week,
        'businesses', coalesce(nb.total, 0),
        'scans', coalesce(sc.total, 0), 'scansFailed', coalesce(sc.failed, 0),
        'enquiries', coalesce(en.total, 0), 'enquiriesWithEmail', coalesce(en.with_email, 0),
        'answersRead', coalesce(ac.answers, 0), 'liveBusinesses', coalesce(ac.live, 0)
      ) order by w.week)
      from (select v_first + 7 * g as week from generate_series(0, p_weeks - 1) g) w
      left join (
        select date_trunc('week', b.created_at at time zone 'Australia/Sydney')::date as week, count(*) as total
        from public.businesses b where b.plan <> 'internal' and b.created_at >= v_since group by 1
      ) nb on nb.week = w.week
      left join (
        select date_trunc('week', s.created_at at time zone 'Australia/Sydney')::date as week, count(*) as total,
          count(*) filter (where public.admin_scan_state(s) = 'failed') as failed
        from public.scans s join public.businesses b on b.id = s.business_id
        where b.plan <> 'internal' and s.created_at >= v_since group by 1
      ) sc on sc.week = w.week
      left join (
        select date_trunc('week', e.created_at at time zone 'Australia/Sydney')::date as week, count(*) as total,
          count(*) filter (where e.email is not null) as with_email
        from public.enquiries e join public.businesses b on b.id = e.business_id
        where b.plan <> 'internal' and e.created_at >= v_since group by 1
      ) en on en.week = w.week
      left join (
        select date_trunc('week', a.day::timestamp)::date as week, sum(a.answers_read) as answers,
          count(distinct a.business_id) filter (where a.button_hours > 0 or a.answers_read > 0) as live
        from public.business_activity a join public.businesses b on b.id = a.business_id
        where b.plan <> 'internal' and a.day >= v_first group by 1
      ) ac on ac.week = w.week
    ), '[]'::jsonb),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.month, 'paying', (
          select count(*) from public.businesses b
          where b.plan <> 'internal' and (
            select p.plan from public.plan_changes p
            where p.business_id = b.id and p.created_at < least(now(), (m.month + interval '1 month')::timestamp at time zone 'Australia/Sydney')
            order by p.created_at desc, p.id desc limit 1
          ) = 'paying'
        )) order by m.month)
      from (select (date_trunc('month', v_today::timestamp) - make_interval(months => g))::date as month from generate_series(0, p_months - 1) g) m
    ), '[]'::jsonb),
    'delivery', (select jsonb_build_object(
        'sent', count(*) filter (where n.status = 'sent'),
        'pending', count(*) filter (where n.status in ('pending', 'sending')),
        'failed', count(*) filter (where n.status = 'failed'))
      from public.enquiry_notifications n
      join public.enquiries e on e.id = n.enquiry_id
      join public.businesses b on b.id = e.business_id
      where b.plan <> 'internal' and n.created_at >= now() - interval '30 days')
  );
end;
$$;

-- SayGday's own chat on saygday.ai (business saygday, CLAUDE.md) is ours: it
-- counts in no total.
with own as (
  update public.businesses set plan = 'internal', plan_changed_at = now() where slug = 'saygday' and plan <> 'internal' returning id
)
insert into public.plan_changes(business_id, plan) select id, 'internal' from own;

-- ---- Only the server may call any of it ------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('count_activity', 'faq_viewed', 'button_seen', 'admin_scan_state', 'admin_business_json',
      'admin_businesses', 'admin_business', 'admin_set_plan', 'admin_trends')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
