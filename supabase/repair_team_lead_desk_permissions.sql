begin;

alter table public.schedule_settings enable row level security;
drop policy if exists "schedule_settings_manage_privileged" on public.schedule_settings;
drop policy if exists "schedule_settings_manage_desk_admin" on public.schedule_settings;
create policy "schedule_settings_manage_privileged"
on public.schedule_settings
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

alter table public.schedule_months enable row level security;
drop policy if exists "schedule_months_manage_privileged" on public.schedule_months;
drop policy if exists "schedule_months_manage_desk_admin" on public.schedule_months;
create policy "schedule_months_manage_privileged"
on public.schedule_months
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

alter table public.schedule_change_requests enable row level security;
drop policy if exists "schedule_change_requests_select_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_select_managers"
on public.schedule_change_requests
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_update_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_update_managers"
on public.schedule_change_requests
for update
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

drop policy if exists "schedule_change_requests_delete_managers" on public.schedule_change_requests;
create policy "schedule_change_requests_delete_managers"
on public.schedule_change_requests
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

alter table public.vacation_months enable row level security;
drop policy if exists "vacation_months_manage_privileged" on public.vacation_months;
drop policy if exists "vacation_months_manage_desk_admin" on public.vacation_months;
create policy "vacation_months_manage_privileged"
on public.vacation_months
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

alter table public.vacation_settings enable row level security;
drop policy if exists "vacation_settings_manage_privileged" on public.vacation_settings;
create policy "vacation_settings_manage_privileged"
on public.vacation_settings
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

alter table public.team_lead_schedule_assignments enable row level security;
drop policy if exists "team_lead_schedule_assignments_select_managers" on public.team_lead_schedule_assignments;
create policy "team_lead_schedule_assignments_select_managers"
on public.team_lead_schedule_assignments
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignments_manage_privileged" on public.team_lead_schedule_assignments;
drop policy if exists "team_lead_schedule_assignments_manage_team_lead_admin" on public.team_lead_schedule_assignments;
create policy "team_lead_schedule_assignments_manage_privileged"
on public.team_lead_schedule_assignments
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

alter table public.team_lead_state enable row level security;
drop policy if exists "team_lead_state_select_managers" on public.team_lead_state;
create policy "team_lead_state_select_managers"
on public.team_lead_state
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_state_manage_team_lead_admin" on public.team_lead_state;
create policy "team_lead_state_manage_team_lead_admin"
on public.team_lead_state
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin')
  and public.current_profile_approved() = true
);

commit;
