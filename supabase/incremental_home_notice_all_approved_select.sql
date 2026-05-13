-- Purpose: Allow every approved signed-in portal user to read the shared home notice workspace.
-- This row stores notices, D-days, and community-board data together, so read access
-- must not depend on popup is_active.

drop policy if exists "home_popup_notice_state_select_active_approved" on public.home_popup_notice_state;
create policy "home_popup_notice_state_select_active_approved"
on public.home_popup_notice_state
for select
to authenticated
using (
  public.current_profile_approved() = true
);
