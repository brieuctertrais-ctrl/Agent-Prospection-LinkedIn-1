-- =============================================================
-- GDPR retention: nightly purge (pg_cron, 03:00 UTC)
--  - rejected / low-score profiles: after purge_rejected_after_months (default 6, editable)
--  - profiles viewed but never decided on: after 3 months
--  - leads contacted without reply (to_contact / invitation_sent / accepted): 3 years after last activity
--    (CNIL recommendation for prospects); replied / meeting leads are kept (active business contacts)
--  - action logs: after 13 months; rate-limit windows: after 2 days; AI usage ledger: after 400 days
-- The exclusion list is kept: it is what guarantees a rejected / opted-out person is never contacted again.
-- =============================================================

alter table public.user_settings drop constraint if exists user_settings_purge_months_check;
alter table public.user_settings add constraint user_settings_purge_months_check
  check (purge_rejected_after_months between 1 and 36);

create or replace function public.purge_rejected_prospects() returns int
language plpgsql security definer set search_path = public as $$
declare
  n int := 0;
  k int;
begin
  -- 1. Rejected / low-score profiles (per-user retention setting). Never if they became a lead.
  delete from public.prospects p
  using public.decisions d, public.user_settings s
  where d.prospect_id = p.id and s.user_id = p.user_id
    and d.decision in ('reject', 'skip_low_score')
    and d.created_at < now() - make_interval(months => s.purge_rejected_after_months)
    and not exists (select 1 from public.leads l where l.prospect_id = p.id);
  get diagnostics k = row_count; n := n + k;

  -- 2. Profiles viewed/scored but never decided on and never in a batch: 3 months.
  delete from public.prospects p
  where p.updated_at < now() - interval '3 months'
    and not exists (select 1 from public.decisions d where d.prospect_id = p.id)
    and not exists (select 1 from public.leads l where l.prospect_id = p.id)
    and not exists (select 1 from public.action_queue q where q.prospect_id = p.id and q.status = 'pending');
  get diagnostics k = row_count; n := n + k;

  -- 3. Contacted without reply: 3 years after the last activity on the lead.
  delete from public.prospects p
  using public.leads l
  where l.prospect_id = p.id
    and l.status in ('to_contact', 'invitation_sent', 'accepted')
    and greatest(l.updated_at, coalesce(l.accepted_at, l.updated_at)) < now() - interval '3 years';
  get diagnostics k = row_count; n := n + k;

  -- 4. Technical data.
  delete from public.action_logs where created_at < now() - interval '13 months';
  delete from public.rate_limits where window_start < now() - interval '2 days';
  delete from public.ai_usage where created_at < now() - interval '400 days';

  return n;
end $$;
revoke execute on function public.purge_rejected_prospects() from public, anon, authenticated;
grant execute on function public.purge_rejected_prospects() to service_role;

-- Nightly schedule. On Supabase, pg_cron is available; elsewhere (local tests) this is skipped.
do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'pg_cron not available here: enable it in Supabase (Database > Extensions > pg_cron) and re-run this file.';
    return;
  end;
  perform cron.schedule('efi-gdpr-purge', '0 3 * * *', 'select public.purge_rejected_prospects()');
end $$;
