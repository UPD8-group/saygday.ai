-- Align only the two active brand chatbots with the owner-approved offer.
-- No client FAQ, billing account, subscription, payment or access is modified.
-- Resolve business identities by the verified slug AND website, not guessed IDs.
-- Preserve FAQ IDs and historical counters; repurpose the retired tier answer.
begin;
do $$
declare sg uuid; studio uuid; changed integer;
begin
  select id into strict sg from public.businesses where slug='saygday' and website in ('https://saygday.ai','https://saygday.ai/');
  select id into strict studio from public.businesses where slug='business-23bcf' and website in ('https://oo.studio','https://oo.studio/');

  update public.faqs f set answer=v.answer,updated_at=now()
  from (values
    ('How much does SayGday cost?', 'SayGday has one simple plan: A$30/month AUD for one supported website. Start with your website, choose the questions, check and approve the suggested answers, then add the chat. Build and preview without a card. Verify your website and add a card for 7 free live days, then A$30/month automatically unless you cancel. Need a website or refresh too? oo.studio is A$60/month total with SayGday included for the covered website, within an agreed scope: https://oo.studio/#plan. Existing customers keep their agreed prices.'),
    ('Is there a free trial?', 'Have a week on us. Build and preview SayGday without a card. Verify your website, then add a card through Stripe to activate 7 free live days. A$30/month AUD starts automatically afterwards unless you cancel. Checkout shows your first billing date. Cancel through Settings → Billing → Manage billing before that date to pay nothing. The software free week does not include website-build work through oo.studio. Existing saved trial dates and agreed prices remain unchanged.'),
    ('What’s included in the price?', 'A$30/month AUD includes suggested questions and answers from your website, your dashboard to edit and approve them, appearance settings, chat on one supported website, submitted enquiries in the dashboard, email notification when a visitor leaves an email address, and product support. You manage the answers and installation. A website build is not included in A$30. The separate oo.studio plan is A$60/month total for a scoped website or refresh, shop setup where needed, hosting and care, with SayGday included: https://oo.studio/#plan.'),
    ('Do I need a website to use SayGday?', 'Yes. SayGday reads your website to prepare suggested answers, and the website needs to allow the supplied chat code. It does not run in Facebook or Instagram messages. Need a new website or a refresh? oo.studio offers a custom-designed website, online shop setup where needed, hosting and care, plus SayGday, for A$60/month total within an agreed scope. Explore https://oo.studio/#plan. No separate SayGday subscription is needed for that covered website.')
  ) as v(question,answer)
  where f.business_id=sg and f.question=v.question and f.status='approved';
  get diagnostics changed = row_count;
  if changed <> 4 then raise exception 'Expected four approved SayGday offer answers'; end if;

  update public.faqs set question='Can you build or refresh my website?',
    answer='Yes, through oo.studio. There is one SayGday software plan at A$30/month. The separate oo.studio service is A$60/month total for a custom-designed website or refresh, online shop setup where needed, supported Square connections, hosting, care and SayGday for that website. Jay agrees pages, shop setup, connections and ongoing work before starting. Processing fees are separate; extra third-party costs and out-of-scope work are agreed first. The software trial does not include website-build work. Already subscribing to SayGday? Contact Jay before moving to coordinate billing and included access, rather than paying for both. Explore https://oo.studio/#plan.',
    variants=array['Can you make me a website?','I need a website','Website refresh','Website and chatbot','Website and online shop','What happened to Managed?','Managed plan','Can Jay set it up for me?','Does the website include SayGday?'],
    updated_at=now()
  where business_id=sg and question in ('What is included in SayGday Managed?','Can you build or refresh my website?') and status='approved';
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Expected one SayGday website-service answer'; end if;

  update public.faqs f set answer=v.answer,updated_at=now()
  from (values
    ('How much does your plan cost?', 'My oo.studio plan is A$60/month AUD total, with no upfront cost for the agreed work. It includes your custom website or refresh, online shop setup where needed, hosting, care and SayGday for that website. It is not A$60 plus a separate A$30 chatbot subscription. Payment processing fees are separate, and I agree extra third-party costs or out-of-scope work before starting. Already happy with your website? SayGday alone is A$30/month at https://saygday.ai/pricing.'),
    ('What''s included in your plan?', 'A$60/month total includes a custom-designed website or refresh, online shop setup where needed, supported Square connections, hosting, care and a SayGday chatbot using answers you approve. I agree the pages, shop setup, connections and ongoing work before starting. Larger migrations, complex integrations and work outside that scope are quoted separately. Processing fees are separate and extra third-party costs are agreed first. No separate SayGday subscription is needed for the covered website.'),
    ('Do I need a separate SayGday subscription?', 'No, not for the website covered by the A$60/month oo.studio plan. SayGday is included in that total. Already paying for standalone SayGday? Contact me before moving so I can coordinate your subscription and included access; nothing is switched or cancelled automatically. For an existing website outside the studio plan, SayGday is A$30/month on its own: https://saygday.ai/pricing.'),
    ('Do you build website chatbots?', 'Yes. I built SayGday, the chatbot you are using here. Already happy with your website? Add it yourself for A$30/month: enter your website, choose the questions, approve the answers and add the code. See https://saygday.ai/pricing. Need a website or refresh too? My separate A$60/month oo.studio plan includes SayGday for the covered website, alongside the agreed website and shop work, hosting and care.')
  ) as v(question,answer)
  where f.business_id=studio and f.question=v.question and f.status='approved';
  get diagnostics changed = row_count;
  if changed <> 4 then raise exception 'Expected four approved oo.studio offer answers'; end if;

  if not exists (select 1 from public.faqs where business_id=studio and question='Can I use SayGday without a new website?') then
    insert into public.faqs(business_id,question,answer,variants,status,featured,source,position)
    values(studio,'Can I use SayGday without a new website?',
      'Yes. Keep your existing website and add SayGday on its own for A$30/month AUD. Sign up, enter your website, choose the questions and approve the answers, then install the chat on a supported website. Build and preview without a card; verify your website and add a card for 7 free live days before monthly billing unless cancelled. Explore https://saygday.ai/pricing. You do not need the A$60 oo.studio website plan to use SayGday.',
      array['I already have a website','Standalone chatbot','Just the chatbot','SayGday pricing','How much is SayGday on its own?'],
      'approved',false,'owner',(select coalesce(max(position),0)+1 from public.faqs where business_id=studio));
  end if;
end $$;
commit;
