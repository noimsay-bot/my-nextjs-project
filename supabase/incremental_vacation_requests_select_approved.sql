-- Purpose: Allow approved portal users to see the shared vacation request board.
-- Impact: Fixes "전체 신청 현황" for non-manager users while keeping writes limited by existing own-request policies.
-- Rollback: DROP POLICY IF EXISTS "vacation_requests_select_approved" ON public.vacation_requests;

drop policy if exists "vacation_requests_select_approved" on public.vacation_requests;

create policy "vacation_requests_select_approved"
on public.vacation_requests
for select
to authenticated
using (public.current_profile_approved() = true);
