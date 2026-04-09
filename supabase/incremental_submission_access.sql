begin;

drop policy if exists "team_lead_state_select_submission_access_approved" on public.team_lead_state;
create policy "team_lead_state_select_submission_access_approved"
on public.team_lead_state
for select
to authenticated
using (
  key = 'submission_access_v1'
  and public.current_profile_approved() = true
);

insert into public.team_lead_state (key, state)
values ('submission_access_v1', '{"isOpen": false}'::jsonb)
on conflict (key) do nothing;

commit;
