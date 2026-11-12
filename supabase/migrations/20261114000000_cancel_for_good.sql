-- =============================================================
-- A cancelled (or failed) autopilot item never comes back in a new batch.
-- Before: only pending / sent items were skipped, so a profile whose invitation was cancelled
-- in the dashboard was proposed again in the next batch.
-- Now: any profile that already has an autopilot item, whatever its status, is skipped.
-- (A failed item can still be retried with the "Retry" button.)
-- =============================================================
create or replace function public.filter_new_profiles(urls text[]) returns setof text
language sql stable security invoker set search_path = public as $$
  select u from unnest(urls) as u
  where not exists (
    select 1 from public.prospects p
    join public.decisions d on d.prospect_id = p.id
    where p.user_id = auth.uid() and p.linkedin_url = u
  )
  and not exists (select 1 from public.exclusion_list e where e.user_id = auth.uid() and e.linkedin_url = u)
  and not exists (
    select 1 from public.prospects p join public.leads l on l.prospect_id = p.id
    where p.user_id = auth.uid() and p.linkedin_url = u
  )
  and not exists (
    select 1 from public.prospects p join public.action_queue q on q.prospect_id = p.id
    where p.user_id = auth.uid() and q.user_id = auth.uid() and p.linkedin_url = u
  );
$$;
revoke execute on function public.filter_new_profiles(text[]) from public, anon;
grant execute on function public.filter_new_profiles(text[]) to authenticated;
