-- =============================================================
-- Sequences: invitation style, delay before the first message, and stopping a sequence for good
--  - user_settings.invitation_note: 'full' (personalised note), 'short' (greeting only), 'none' (no note)
--  - user_settings.first_message_delay_days: minimum days between the invitation and the first message
--  - leads.invited_at: when the invitation was sent; leads.sequence_stopped_at: no more messages, ever
--  - rejecting a follow-up / reminder in the dashboard stops the sequence (it used to come back)
-- =============================================================

alter table public.user_settings add column if not exists invitation_note text not null default 'full';
alter table public.user_settings add column if not exists first_message_delay_days int not null default 0;
alter table public.user_settings drop constraint if exists user_settings_invitation_note_check;
alter table public.user_settings add constraint user_settings_invitation_note_check
  check (invitation_note in ('full', 'short', 'none'));
alter table public.user_settings drop constraint if exists user_settings_first_message_delay_check;
alter table public.user_settings add constraint user_settings_first_message_delay_check
  check (first_message_delay_days between 0 and 30);

alter table public.leads add column if not exists invited_at timestamptz;
alter table public.leads add column if not exists sequence_stopped_at timestamptz;

-- Existing leads: invitation date taken from the action log.
update public.leads l
   set invited_at = a.first_at
  from (
    select user_id, prospect_id, min(created_at) as first_at
    from public.action_logs
    where action_type = 'invitation' and result = 'success' and prospect_id is not null
    group by user_id, prospect_id
  ) a
 where a.user_id = l.user_id and a.prospect_id = l.prospect_id and l.invited_at is null;

-- Ends the message sequence of the caller's prospects: pending messages cancelled, never proposed again.
-- SECURITY INVOKER + explicit auth.uid() filters: only the caller's own rows change.
create or replace function public.stop_sequence(p_prospects uuid[]) returns int
language plpgsql security invoker set search_path = public as $$
declare
  n int;
begin
  if coalesce(cardinality(p_prospects), 0) > 200 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;
  update public.action_queue
     set status = 'cancelled', error = 'sequence_stopped'
   where user_id = auth.uid()
     and prospect_id = any(coalesce(p_prospects, '{}'))
     and action_type = 'message'
     and status = 'pending';
  update public.leads
     set sequence_stopped_at = now(), last_action = 'sequence_stopped'
   where user_id = auth.uid()
     and prospect_id = any(coalesce(p_prospects, '{}'))
     and sequence_stopped_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.stop_sequence(uuid[]) from public, anon;
grant execute on function public.stop_sequence(uuid[]) to authenticated;

-- Prospects whose follow-up was already rejected (before this fix): stop their sequence now.
update public.leads l
   set sequence_stopped_at = now(), last_action = 'sequence_stopped'
 where l.sequence_stopped_at is null
   and exists (
     select 1 from public.action_queue q
     where q.user_id = l.user_id and q.prospect_id = l.prospect_id
       and q.action_type = 'message' and q.status = 'cancelled' and q.error in ('rejected', 'cancelled_by_user')
   );

-- Review: rejecting a message now stops the sequence (see above).
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
    select q.id, q.action_type, q.prospect_id, (q.payload->>'message_id')::uuid as message_id, c.persona_id
    from public.action_queue q
    left join public.campaigns c on c.id = q.campaign_id
    where q.id = any(coalesce(p_approve, '{}')) and q.user_id = auth.uid()
      and q.status = 'pending' and (q.payload->>'needs_approval')::boolean is true
  loop
    if r.action_type = 'invitation' then
      insert into public.decisions (user_id, prospect_id, persona_id, decision)
      values (auth.uid(), r.prospect_id, r.persona_id, 'approve')
      on conflict (user_id, prospect_id) do update set decision = 'approve';

      insert into public.leads (user_id, prospect_id, persona_id, message_id, last_action)
      values (auth.uid(), r.prospect_id, r.persona_id, r.message_id, 'batch_approved')
      on conflict (user_id, prospect_id) do update set message_id = excluded.message_id, last_action = 'batch_approved';
    end if;

    update public.action_queue
       set payload = payload || '{"needs_approval": false}'::jsonb, scheduled_at = now()
     where id = r.id;
    n := n + 1;
  end loop;

  for r in
    select q.id, q.action_type, q.prospect_id, c.persona_id
    from public.action_queue q
    left join public.campaigns c on c.id = q.campaign_id
    where q.id = any(coalesce(p_reject, '{}')) and q.user_id = auth.uid() and q.status = 'pending'
  loop
    if r.action_type = 'invitation' then
      insert into public.decisions (user_id, prospect_id, persona_id, decision)
      values (auth.uid(), r.prospect_id, r.persona_id, 'reject')
      on conflict (user_id, prospect_id) do update set decision = 'reject';
    end if;
    update public.action_queue set status = 'cancelled', error = 'rejected' where id = r.id;
    if r.action_type = 'message' then
      -- Rejecting a follow-up or a reminder ends the sequence for this person: nothing is proposed again.
      perform public.stop_sequence(array[r.prospect_id]);
    end if;
    n := n + 1;
  end loop;

  return n;
end $$;

revoke execute on function public.review_batch(uuid[], uuid[]) from public, anon;
grant execute on function public.review_batch(uuid[], uuid[]) to authenticated;
