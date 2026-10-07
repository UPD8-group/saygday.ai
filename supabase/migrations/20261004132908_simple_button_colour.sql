-- Per-business simple button colour; animal artwork is always fixed.
begin;
alter table public.businesses add column button_colour text not null default '#31584a'
  check (button_colour ~ '^#[0-9a-f]{6}$');
create or replace function public.business_json(b public.businesses)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'slug', b.slug, 'name', b.name, 'website', b.website, 'notifyEmail', b.notify_email,
    'character', b.character, 'buttonColour', b.button_colour, 'greeting', b.greeting, 'signedBy', b.signed_by, 'buttonSeenAt', b.button_seen_at, 'createdAt', b.created_at,
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
create or replace function public.widget(p_slug text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('slug', b.slug, 'name', b.name, 'character', b.character, 'buttonColour', b.button_colour, 'greeting', b.greeting, 'signedBy', b.signed_by, 'website', b.website,
    'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'variants', to_jsonb(f.variants), 'featured', f.featured)
      order by f.featured desc, f.position, f.created_at) from public.faqs f where f.business_id = b.id and f.status = 'approved'), '[]'::jsonb))
  from public.businesses b where b.slug = p_slug and b.website_verified_at is not null
$$;
drop function public.update_business(uuid, text, text, text, text, uuid);
create function public.update_business(p_user uuid, p_name text default null, p_notify_email text default null, p_character text default null, p_greeting text default null, p_business uuid default null, p_button_colour text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v public.businesses := public.owned_business(p_user, p_business);
begin
  update public.businesses set
    name = coalesce(nullif(btrim(regexp_replace(p_name, '\s+', ' ', 'g')), ''), name),
    notify_email = coalesce(nullif(lower(btrim(p_notify_email)), ''), notify_email),
    button_colour = coalesce(lower(p_button_colour), button_colour),
    character = coalesce(p_character, character),
    greeting = coalesce(nullif(btrim(p_greeting), ''), greeting),
    updated_at = now()
  where id = v.id
  returning * into v;
  return public.business_json(v);
end;
$$;
revoke all on function public.update_business(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.update_business(uuid, text, text, text, text, uuid, text) to service_role;
commit;
notify pgrst, 'reload schema';
