-- =============================================================
-- Autopilot, step C: reminders (J+3 / J+7 / J+14) + reply detection
-- =============================================================

alter table public.leads add column if not exists replied_at timestamptz;

-- Reminder delays in days after the first follow-up message (editable in Settings).
alter table public.user_settings
  add column if not exists followup_delays int[] not null default '{3,7,14}';
alter table public.user_settings drop constraint if exists user_settings_followup_delays_check;
alter table public.user_settings add constraint user_settings_followup_delays_check check (
  cardinality(followup_delays) = 3
  and followup_delays[1] between 1 and 60
  and followup_delays[2] between followup_delays[1] + 1 and 90
  and followup_delays[3] between followup_delays[2] + 1 and 120
);

-- One message of each kind (follow-up #1, reminders #2..#4) per prospect.
drop index if exists public.action_queue_one_followup1;
create unique index if not exists action_queue_one_message_kind
  on public.action_queue (prospect_id, (payload->>'kind'))
  where action_type = 'message' and status in ('pending', 'done');

-- The prospect replied: stop the sequence (cancel pending messages) and mark the lead.
-- SECURITY INVOKER + explicit auth.uid() filters: only the caller's own rows change.
create or replace function public.mark_replied(p_prospects uuid[]) returns setof uuid
language plpgsql security invoker set search_path = public as $$
begin
  if coalesce(cardinality(p_prospects), 0) > 200 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  update public.action_queue
     set status = 'cancelled', error = 'replied'
   where user_id = auth.uid()
     and prospect_id = any(coalesce(p_prospects, '{}'))
     and action_type = 'message'
     and status = 'pending';

  return query
  update public.leads
     set status = 'replied', replied_at = now(), last_action = 'replied'
   where user_id = auth.uid()
     and prospect_id = any(coalesce(p_prospects, '{}'))
     and status in ('invitation_sent', 'accepted')
  returning prospect_id;
end $$;
revoke execute on function public.mark_replied(uuid[]) from public, anon;
grant execute on function public.mark_replied(uuid[]) to authenticated;
