-- The founder's verified admin account never needs a subscription, including
-- new profiles. Bind the exemption to its Auth ID, never a browser email,
-- notification address or editable metadata. Service requests need no access
-- to auth.users; only this migration resolves the account's identity.
begin;

create table if not exists public.billing_exempt_owners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.billing_exempt_owners enable row level security;
revoke all on table public.billing_exempt_owners from public, anon, authenticated, service_role;
grant select on table public.billing_exempt_owners to service_role;

insert into public.billing_exempt_owners(user_id)
  select id from auth.users
  where lower(email) = 'hello@oo.studio' and email_confirmed_at is not null
  on conflict (user_id) do nothing;

create or replace function public.billing_enforce_owner_exemption()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if exists(select 1 from public.billing_exempt_owners where user_id = new.owner_id) then
    -- Do not silently record a paid/trial plan in admin history while the
    -- trigger keeps the actual business internal. Reject that edit instead.
    if tg_op = 'UPDATE' and old.owner_id = new.owner_id
      and old.plan = 'internal' and new.plan <> 'internal' then
      raise exception 'BILLING_EXEMPT_OWNER' using errcode = '22023';
    end if;
    if new.plan <> 'internal' then new.plan_changed_at := now(); end if;
    new.plan := 'internal';
  elsif tg_op = 'UPDATE' and old.owner_id is distinct from new.owner_id
    and old.plan = 'internal'
    and exists(select 1 from public.billing_exempt_owners where user_id = old.owner_id) then
    -- A profile transferred to a customer follows normal customer billing.
    new.plan := 'trial';
    new.plan_changed_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.billing_enforce_owner_exemption() from public, anon, authenticated;
grant execute on function public.billing_enforce_owner_exemption() to service_role;

drop trigger if exists businesses_owner_billing_exemption on public.businesses;
create trigger businesses_owner_billing_exemption
  before insert or update of owner_id, plan on public.businesses
  for each row execute function public.billing_enforce_owner_exemption();

-- Existing profiles receive the same permanent internal access. Preserve all
-- trial/provider records and retain the plan change in the existing history.
with changed as (
  update public.businesses b set plan = 'internal', plan_changed_at = now()
  where exists(select 1 from public.billing_exempt_owners e where e.user_id = b.owner_id)
    and b.plan <> 'internal'
  returning b.id
)
insert into public.plan_changes(business_id, plan)
  select id, 'internal' from changed;

commit;
