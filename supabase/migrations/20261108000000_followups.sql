-- =============================================================
-- Autopilot, step B: accepted invitations + follow-up message #1
-- =============================================================

-- Instructions specific to the follow-up message (per persona).
alter table public.copywriting_settings
  add column if not exists followup_instructions text not null default ''
  check (char_length(followup_instructions) <= 2000);

alter table public.leads add column if not exists accepted_at timestamptz;

-- Marks as "accepted" the caller's leads whose profile appears in their LinkedIn connections.
-- SECURITY INVOKER + explicit auth.uid() filter: only the caller's own leads can change.
create or replace function public.mark_accepted(urls text[]) returns setof uuid
language sql security invoker set search_path = public as $$
  update public.leads l
     set status = 'accepted', accepted_at = now(), last_action = 'accepted'
    from public.prospects p
   where l.prospect_id = p.id
     and p.user_id = auth.uid()
     and l.user_id = auth.uid()
     and l.status = 'invitation_sent'
     and p.linkedin_url = any(coalesce(urls, '{}'))
     and cardinality(coalesce(urls, '{}')) <= 500
  returning l.prospect_id;
$$;
revoke execute on function public.mark_accepted(text[]) from public, anon;
grant execute on function public.mark_accepted(text[]) to authenticated;

-- One follow-up #1 per prospect (unless the previous one was cancelled or failed).
create unique index if not exists action_queue_one_followup1
  on public.action_queue (prospect_id)
  where action_type = 'message' and payload->>'kind' = 'followup_1' and status in ('pending', 'done');

-- Review now handles follow-up messages too:
--  - invitation: approve → decision + lead + ready to send ; reject → excluded (never proposed again)
--  - message:    approve → ready to send ; reject → cancelled (the contact is NOT excluded)
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
    n := n + 1;
  end loop;

  return n;
end $$;
