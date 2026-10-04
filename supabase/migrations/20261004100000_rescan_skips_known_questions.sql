-- A second scan must not redraft what the chat already answers (the owner's
-- end-to-end audit, 4 October 2026: a re-scan of the same website drafted
-- fifteen rewordings of questions the owner had just approved). The scan job
-- reads the business's known questions and drops any draft the chat's own
-- matcher would already answer (netlify/functions/_lib/scan.mjs). Untouched
-- drafts from the previous scan are not "known": finish_scan replaces them.
begin;

create function public.scan_known_questions(p_scan uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'question', f.question, 'variants', to_jsonb(f.variants), 'answer', f.answer))
    from public.faqs f join public.scans s on s.business_id = f.business_id
    where s.id = p_scan and not (f.source = 'scan' and f.status = 'draft' and f.updated_at = f.created_at)), '[]'::jsonb)
$$;

revoke all on function public.scan_known_questions(uuid) from public, anon, authenticated;
grant execute on function public.scan_known_questions(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
