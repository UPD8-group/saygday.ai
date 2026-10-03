-- Who signs off a business's answers (owner, 3 October 2026: make the real
-- chat look like the front page's example, where every answer carries "Sam"
-- in handwriting and a "Signed off by Sam" stamp). A first name the owner
-- chooses, shown on every answer in the chat and in "That's one for Sam" when
-- the chat can't answer. Optional: without one, the chat names the business.
begin;

alter table public.businesses
  add column signed_by text check (signed_by is null or char_length(signed_by) between 1 and 40);

create or replace function public.my_business(p_user uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when b.id is null then null else jsonb_build_object(
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
  ) end
  from (select 1) one left join public.businesses b on b.owner_id = p_user
$$;

create or replace function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'greeting', b.greeting, 'signedBy', b.signed_by, 'website', b.website,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug and b.website_verified_at is not null
$$;

-- The owner sets the name (or an empty string takes it off). A function of
-- its own, so update_business keeps the signature every caller already uses.
create function public.set_signed_by(p_user uuid, p_signed_by text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user);
begin
  update public.businesses set
    signed_by = nullif(btrim(regexp_replace(coalesce(p_signed_by, ''), '\s+', ' ', 'g')), ''),
    updated_at = now()
  where id = v.id;
  return public.my_business(p_user);
end;
$$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('my_business', 'widget', 'set_signed_by')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
