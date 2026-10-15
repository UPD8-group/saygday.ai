-- Owner-approved SayGday website copy, 16 October 2026.
-- Scope: the platform's OWN chatbot only. Never another business's answers.
-- This is a content update, not a customer-billing mutation. Existing answer
-- IDs, approval state, variants, featured flags and usage counts are retained.
-- New Managed FAQ uses its generated database ID, not a hardcoded row ID.
begin;
do $$
declare business uuid; changed integer;
begin
  select id into strict business from public.businesses
    where slug='saygday' and website in ('https://saygday.ai','https://saygday.ai/');
  update public.faqs set answer='SayGday is A$59/month AUD when you manage the answers and installation yourself. SayGday Managed is A$75/month AUD, with setup help and a defined monthly content allowance: about A$2.50 a day based on a 30-day month, billed monthly. Build and preview self-managed without a card. Verify your website and add a card for 7 free live days, then A$59/month automatically unless you cancel. Managed is enquiry-led; its setup work is not included in the free week. Existing customers keep their agreed prices.', updated_at=now()
    where business_id=business and question='How much does SayGday cost?' and status='approved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Expected exactly one approved SayGday price answer'; end if;
  update public.faqs set answer='Have a week on us with self-managed SayGday. Build and preview without a card. Verify your website, then add a card through Stripe to activate 7 free live days. A$59/month AUD starts automatically afterwards unless you cancel. Checkout shows your first billing date. Cancel through Settings → Billing → Manage billing before that date to pay nothing. Managed setup work is not included. Existing customers keep their saved trial dates and agreed prices.', updated_at=now()
    where business_id=business and question='Is there a free trial?' and status='approved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Expected exactly one approved SayGday trial answer'; end if;
  update public.faqs set answer='A$59/month AUD includes your approved answers in a chat on one supported website, suggested questions and answers from your pages, your appearance settings, submitted enquiries in your dashboard, email notification when a visitor provides an email address, and product support. You manage the answers and installation. Managed is A$75/month with setup help and a defined monthly content allowance; we agree the scope before payment. Website builds, online shops and payment-system setup are separate oo.studio services.', updated_at=now()
    where business_id=business and question='What’s included in the price?' and status='approved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Expected exactly one approved SayGday inclusions answer'; end if;
  if not exists (select 1 from public.faqs where business_id=business and question='What is included in SayGday Managed?') then
    insert into public.faqs(business_id,question,answer,variants,status,featured,source,position)
      values(business,'What is included in SayGday Managed?',
        'SayGday Managed is A$75/month AUD: about A$2.50 a day based on a 30-day month, billed monthly. It includes the software, preparation of up to 20 initial short answers, standard installation on one supported website and initial checks. You also get up to 20 minutes of monthly content work, shared between review and small answer updates; unused time does not roll over. Your business approves the answers. Extra work is quoted separately. Ask through our contact page so we can agree compatibility, scope and the start date before payment. The self-managed free week does not include this hands-on work.',
        array['Managed','Managed plan','What is Managed?','How much is Managed?','Can Jay set it up for me?','Can James set it up for me?','Can someone manage my chatbot?','What does the managed plan include?'],
        'approved',false,'owner',(select coalesce(max(position),0)+1 from public.faqs where business_id=business));
  end if;
end $$;
commit;
