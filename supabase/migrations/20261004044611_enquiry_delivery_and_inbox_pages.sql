-- Apply before deploying the new functions. Old ask_team/list_enquiries are
-- retained for the preceding deploy. No historical enquiry is queued here.
begin;

create table public.enquiry_notifications (
  enquiry_id uuid primary key references public.enquiries(id) on delete cascade,
  payload jsonb not null,
  message jsonb,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index enquiry_notifications_due_idx on public.enquiry_notifications(next_attempt_at)
  where status in ('pending','sending');
create index enquiries_status_page_idx on public.enquiries(business_id, status, created_at desc, id desc);
alter table public.enquiry_notifications enable row level security;
revoke all on table public.enquiry_notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.enquiry_notifications to service_role;

-- Capture recipient, business name and public sender settings at submission.
-- Retries use the same payload and idempotency key even if settings change.
create function public.ask_team_queued(p_slug text, p_question text, p_email text default null,
  p_sender text default null, p_public_url text default 'https://saygday.ai')
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare e jsonb;
begin
  e := public.ask_team(p_slug, p_question, p_email);
  if nullif(e->>'email', '') is not null then
    insert into public.enquiry_notifications(enquiry_id, payload)
      values ((e->>'id')::uuid, e || jsonb_build_object('sender', p_sender, 'publicUrl', p_public_url));
  end if;
  return e;
end;
$$;

-- One short lease per job; expired leases can be retried after a crashed
-- process. Stop well inside Resend's 24-hour idempotency-key lifetime.
create function public.claim_enquiry_notifications(p_id uuid default null, p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 3 then raise exception 'INVALID_LIMIT' using errcode = '22023'; end if;
  update public.enquiry_notifications set status = 'failed', failure_code = 'RETRY_EXHAUSTED',
    lease_token = null, lease_until = null, updated_at = now()
    where status in ('pending','sending') and (p_id is null or enquiry_id = p_id)
      and (status = 'pending' or lease_until <= now())
      and (attempts >= 8 or created_at <= now() - interval '23 hours');
  with due as (
    select enquiry_id from public.enquiry_notifications
      where (p_id is null or enquiry_id = p_id) and attempts < 8 and created_at > now() - interval '23 hours'
        and ((status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and lease_until <= now()))
      order by next_attempt_at, enquiry_id for update skip locked limit p_limit
  ), claimed as (
    update public.enquiry_notifications n set status = 'sending', attempts = attempts + 1,
      lease_token = gen_random_uuid(), lease_until = now() + interval '2 minutes', updated_at = now()
      from due where n.enquiry_id = due.enquiry_id
      returning n.payload, n.message, n.lease_token, n.attempts
  ) select coalesce(jsonb_agg(jsonb_build_object('enquiry', payload, 'message', message, 'lease', lease_token, 'attempt', attempts)), '[]'::jsonb)
      into result from claimed;
  return result;
end;
$$;

-- Freeze the complete rendered request before its first send, so a template
-- change in a later deployment cannot change the payload behind the key.
create function public.prepare_enquiry_notification(p_id uuid, p_lease uuid, p_message jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if p_message is null or jsonb_typeof(p_message) <> 'object' then raise exception 'INVALID_MESSAGE' using errcode = '22023'; end if;
  update public.enquiry_notifications set message = coalesce(message, p_message)
    where enquiry_id = p_id and status = 'sending' and lease_token = p_lease
    returning message into result;
  return result;
end;
$$;

create function public.finish_enquiry_notification(p_id uuid, p_lease uuid, p_sent boolean,
  p_retryable boolean default false, p_failure_code text default null)
returns text language plpgsql security invoker set search_path = '' as $$
declare n public.enquiry_notifications; next_status text;
begin
  select * into n from public.enquiry_notifications
    where enquiry_id = p_id and status = 'sending' and lease_token = p_lease for update;
  if not found then return null; end if;
  next_status := case when p_sent then 'sent'
    when p_retryable and n.attempts < 8 and n.created_at > now() - interval '23 hours' then 'pending' else 'failed' end;
  update public.enquiry_notifications set status = next_status, lease_token = null, lease_until = null,
    failure_code = case when p_sent then null else left(coalesce(p_failure_code, 'SEND_FAILED'), 60) end,
    next_attempt_at = now() + make_interval(secs => least(3600, (60 * power(2, n.attempts - 1))::integer)), updated_at = now()
    where enquiry_id = p_id;
  if p_sent then perform public.enquiry_emailed(p_id); end if;
  return next_status;
end;
$$;

-- Filter by status BEFORE limiting; timestamp + UUID is a stable cursor even
-- when many enquiries arrive together. Counts cover the entire inbox.
create function public.enquiries_page(p_user uuid, p_status text default 'new', p_limit integer default 50,
  p_before timestamptz default null, p_before_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.businesses := public.owned_business(p_user); rows jsonb; cursor jsonb; n integer;
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

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('ask_team_queued','claim_enquiry_notifications','prepare_enquiry_notification','finish_enquiry_notification','enquiries_page')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;
commit;
notify pgrst, 'reload schema';
