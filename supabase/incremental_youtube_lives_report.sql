-- DESK > 모바일 라이브 > 주간업무보고서
-- incremental_youtube_lives.sql 적용 후 실행한다.
-- report_selected: 참여 체크(노랑) 중 주간 보고서에 넣을 건(연한 레드).
-- 레드는 노랑의 상위 단계라 참여 통계(live_participation 행 수)는 그대로 유지된다.
-- 변경: 승인된 desk/team_lead (체크/해제 권한과 동일)

alter table public.live_participation
add column if not exists report_selected boolean not null default false;

drop policy if exists "live_participation_update_desk" on public.live_participation;
create policy "live_participation_update_desk"
on public.live_participation
for update
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'team_lead')
  and public.current_profile_approved() = true
);

grant update (report_selected) on table public.live_participation to authenticated;

notify pgrst, 'reload schema';
