-- Agreed business prices are service-managed; ordinary sign-ups keep the public price.
begin;
alter table public.billing_accounts add column price_override_id text, add column price_override_amount integer;
alter table public.billing_accounts add constraint billing_price_override_check check (
  (price_override_id is null and price_override_amount is null) or
  (price_override_id is not null and price_override_amount is not null and price_override_id ~ '^price_[A-Za-z0-9]+$' and price_override_amount between 1 and 1000000)
);

create or replace function public.admin_business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'ownerId', b.owner_id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'buttonColour', b.button_colour, 'createdAt', b.created_at,
    'billing', (select jsonb_build_object('enabled', s.enabled, 'trialStartedAt', a.trial_started_at,
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

revoke all on function public.admin_business_json(public.businesses) from public,anon,authenticated;
grant execute on function public.admin_business_json(public.businesses) to service_role;
notify pgrst, 'reload schema';
commit;
