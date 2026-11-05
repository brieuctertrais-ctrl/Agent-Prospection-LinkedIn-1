-- =============================================================
-- Autopilot, step A: batch preparation + validation, then paced sending.
-- Uses the existing tables `campaigns` and `action_queue` (RLS already enforced).
--   action_queue row for a proposed invitation:
--     status 'pending' + payload.needs_approval = true   → awaiting the user's review
--     status 'pending' + payload.needs_approval = false  → approved, to be sent by the extension
--     status 'done' / 'failed' / 'cancelled'
-- =============================================================

-- Allowed queue actions and bounded payload.
alter table public.action_queue
  add constraint action_queue_type check (action_type in ('invitation','message','visit','follow','like','withdraw')),
  add constraint action_queue_payload_size check (pg_column_size(payload) <= 4096),
  add constraint action_queue_error_length check (char_length(coalesce(error, '')) <= 200);

alter table public.campaigns
  add constraint campaigns_paused_reason_length check (char_length(coalesce(paused_reason, '')) <= 100);

create index if not exists action_queue_prospect_idx on public.action_queue (prospect_id);

-- A profile already in a batch (to review, approved, or sent) is never proposed again.
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
    where p.user_id = auth.uid() and p.linkedin_url = u and q.status in ('pending', 'done')
  );
$$;

-- Review of a batch by its owner: approve (→ decision + lead, ready to send) or reject (→ excluded).
-- SECURITY INVOKER: every statement goes through RLS, so only the caller's own rows are touched.
create or replace function public.review_batch(p_approve uuid[], p_reject uuid[]) returns int
language plpgsql security invoker set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  if coalesce(cardinality(p_approve), 0) + coalesce(cardinality(p_reject), 0) > 200 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  for r in
    select q.id, q.prospect_id, (q.payload->>'message_id')::uuid as message_id, c.persona_id
    from public.action_queue q
    left join public.campaigns c on c.id = q.campaign_id
    where q.id = any(coalesce(p_approve, '{}')) and q.user_id = auth.uid()
      and q.status = 'pending' and (q.payload->>'needs_approval')::boolean is true
  loop
    insert into public.decisions (user_id, prospect_id, persona_id, decision)
    values (auth.uid(), r.prospect_id, r.persona_id, 'approve')
    on conflict (user_id, prospect_id) do update set decision = 'approve';

    insert into public.leads (user_id, prospect_id, persona_id, message_id, last_action)
    values (auth.uid(), r.prospect_id, r.persona_id, r.message_id, 'batch_approved')
    on conflict (user_id, prospect_id) do update set message_id = excluded.message_id, last_action = 'batch_approved';

    update public.action_queue
       set payload = payload || '{"needs_approval": false}'::jsonb, scheduled_at = now()
     where id = r.id;
    n := n + 1;
  end loop;

  for r in
    select q.id, q.prospect_id, c.persona_id
    from public.action_queue q
    left join public.campaigns c on c.id = q.campaign_id
    where q.id = any(coalesce(p_reject, '{}')) and q.user_id = auth.uid() and q.status = 'pending'
  loop
    insert into public.decisions (user_id, prospect_id, persona_id, decision)
    values (auth.uid(), r.prospect_id, r.persona_id, 'reject')
    on conflict (user_id, prospect_id) do update set decision = 'reject';
    update public.action_queue set status = 'cancelled', error = 'rejected' where id = r.id;
    n := n + 1;
  end loop;

  return n;
end $$;

revoke execute on function public.review_batch(uuid[], uuid[]) from public, anon;
grant execute on function public.review_batch(uuid[], uuid[]) to authenticated;
