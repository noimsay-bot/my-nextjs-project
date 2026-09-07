-- 베스트리포트 분기 초기화 시각(best_report_current_v1)을 승인된 사용자가 읽을 수 있도록 허용.
-- 제출 화면이 현재 분기 제출만 표시하려면 클라이언트에서 resetAt 기준선을 알아야 한다.
-- 기존 submission_access_v1 조회 정책과 동일한 범위(승인된 authenticated 사용자, 특정 key 한정)로만 확장한다.

drop policy if exists "team_lead_state_select_submission_access_approved" on public.team_lead_state;
create policy "team_lead_state_select_submission_access_approved"
on public.team_lead_state
for select
to authenticated
using (
  key in ('submission_access_v1', 'best_report_current_v1')
  and public.current_profile_approved() = true
);
