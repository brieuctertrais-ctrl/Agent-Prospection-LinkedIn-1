-- =============================================================
-- Statistics page: one call returns the caller's funnel, weekly series and per-persona table.
-- SECURITY INVOKER + explicit auth.uid() filters: a user only ever sees their own figures.
-- Cohort logic: leads whose (first) invitation was sent during the period, and what became of them.
-- =============================================================
create or replace function public.get_stats(p_days int default 30) returns jsonb
language sql stable security invoker set search_path = public as $$
  with since as (
    select now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365)) as t
  ),
  inv as (
    select distinct on (a.prospect_id) a.prospect_id, a.created_at
    from public.action_logs a, since
    where a.user_id = auth.uid() and a.action_type = 'invitation' and a.result = 'success'
      and a.prospect_id is not null and a.created_at >= since.t
    order by a.prospect_id, a.created_at
  ),
  cohort as (
    select inv.prospect_id, inv.created_at as invited_at, l.status, l.persona_id
    from inv
    join public.leads l on l.prospect_id = inv.prospect_id and l.user_id = auth.uid()
  ),
  weeks as (
    select wk from since, generate_series(date_trunc('week', since.t), date_trunc('week', now()), interval '1 week') as wk
  )
  select jsonb_build_object(
    'days', least(greatest(coalesce(p_days, 30), 1), 365),
    'views', (select count(*) from public.action_logs a, since
              where a.user_id = auth.uid() and a.action_type = 'profile_view' and a.result = 'success' and a.created_at >= since.t),
    'approved', (select count(*) from public.decisions d, since
                 where d.user_id = auth.uid() and d.decision = 'approve' and d.created_at >= since.t),
    'invited', (select count(*) from cohort),
    'accepted', (select count(*) from cohort where status in ('accepted', 'replied', 'meeting')),
    'replied', (select count(*) from cohort where status in ('replied', 'meeting')),
    'meetings', (select count(*) from cohort where status = 'meeting'),
    'messages', (select count(*) from public.action_logs a, since
                 where a.user_id = auth.uid() and a.action_type = 'message' and a.result = 'success' and a.created_at >= since.t),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'week', to_char(w.wk, 'YYYY-MM-DD'),
        'invited', (select count(*) from cohort c where date_trunc('week', c.invited_at) = w.wk),
        'accepted', (select count(*) from cohort c where date_trunc('week', c.invited_at) = w.wk
                       and c.status in ('accepted', 'replied', 'meeting'))
      ) order by w.wk), '[]'::jsonb)
      from weeks w
    ),
    'personas', (
      select coalesce(jsonb_agg(row_to_json(s) order by s.invited desc), '[]'::jsonb)
      from (
        select coalesce(p.name, '—') as name,
               count(*) as invited,
               count(*) filter (where c.status in ('accepted', 'replied', 'meeting')) as accepted,
               count(*) filter (where c.status in ('replied', 'meeting')) as replied,
               count(*) filter (where c.status = 'meeting') as meetings
        from cohort c
        left join public.personas p on p.id = c.persona_id and p.user_id = auth.uid()
        group by coalesce(p.name, '—')
      ) s
    )
  );
$$;
revoke execute on function public.get_stats(int) from public, anon;
grant execute on function public.get_stats(int) to authenticated;
