-- Rate limits keep no one's address (the website's privacy page, 2 October
-- 2026). The server now sends only the kind of limit and a scrambled form of
-- what it counts (netlify/functions/_lib/runtime.mjs), and rows older than a
-- day (every limit's window is a day or less) are cleared as requests come
-- in. The rows from before this change held internet and email addresses in
-- a readable form, so they go now; the only cost is that today's counts start
-- again.
delete from public.rate_limits;
create index rate_limits_window_idx on public.rate_limits(window_started_at);

create or replace function public.rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_allowed boolean;
begin
  if p_key is null or p_limit is null or p_limit < 1 or p_limit > 1000000 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'INVALID_LIMIT' using errcode = '22023';
  end if;
  delete from public.rate_limits where window_started_at < clock_timestamp() - interval '1 day';
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
