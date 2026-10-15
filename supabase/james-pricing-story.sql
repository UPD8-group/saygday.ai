-- Copy-only alignment for SayGday's own chatbot. Run after publishing the
-- owner-approved James / Spare change. On purpose. page copy.
-- This is not a schema migration. Never touch client or oo.studio FAQs,
-- billing, trials, access, sign-in settings, enquiries or email queues.
-- Resolve the owned public brand by its verified slug AND website.
begin;
do $$
declare target_business uuid; changed integer;
begin
  select id into strict target_business from public.businesses
    where slug='saygday' and website in ('https://saygday.ai','https://saygday.ai/');

  update public.faqs f
    set question=regexp_replace(f.question,'\mJay\M','James','g'),
        answer=regexp_replace(f.answer,'\mJay\M','James','g'),
        variants=array(select regexp_replace(v,'\mJay\M','James','g')
          from unnest(f.variants) with ordinality as item(v,n) order by n),
        updated_at=now()
    where f.business_id=target_business
      and concat_ws(' ',f.question,f.answer,array_to_string(f.variants,' ')) ~ '\mJay\M';

  -- Keep existing identities, status, variants and counters for this answer.
  update public.faqs set answer='Spare change. On purpose. SayGday is A$30/month AUD for one supported website. With the cost of living putting pressure on small businesses, we wanted a more helpful website to be affordable. SayGday helps customers find your approved answers, understand what you offer and feel more confident choosing your business. Build and preview without a card; verify your website and add a card for 7 free live days, then A$30/month automatically unless you cancel. Checkout shows your first billing date. Need a website too? The separate oo.studio plan is A$60/month total with SayGday included for that website, within an agreed scope: https://oo.studio/#plan. Existing customers keep their agreed prices.', updated_at=now()
    where business_id=target_business and question='How much does SayGday cost?' and status='approved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Expected exactly one approved SayGday price answer'; end if;

  if exists (select 1 from public.faqs where business_id=target_business and question='Why have you kept SayGday affordable?') then
    update public.faqs set answer='Spare change. On purpose. Running a small business is expensive enough. We wanted SayGday to be something you can add to the website you already have, without taking on another big monthly bill. For A$30/month, it makes your approved answers easier to find, so customers can understand what you offer, work out whether your business is right for them and take the next step when they’re ready. One simple job, priced to be useful.', updated_at=now()
      where business_id=target_business and question='Why have you kept SayGday affordable?' and status='approved';
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'Existing affordability answer needs review'; end if;
  else
    insert into public.faqs(business_id,question,answer,variants,status,featured,source,position)
      values(target_business,'Why have you kept SayGday affordable?',
        'Spare change. On purpose. Running a small business is expensive enough. We wanted SayGday to be something you can add to the website you already have, without taking on another big monthly bill. For A$30/month, it makes your approved answers easier to find, so customers can understand what you offer, work out whether your business is right for them and take the next step when they’re ready. One simple job, priced to be useful.',
        array['Why is SayGday so cheap?','Why have you made it affordable?','Why is it only thirty dollars?','What does spare change on purpose mean?','Why is your pricing low?'],
        'approved',false,'owner',(select coalesce(max(position),0)+1 from public.faqs where business_id=target_business));
  end if;
end $$;
commit;
