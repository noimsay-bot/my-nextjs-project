-- 총괄팀장 보호 데이터 열쇠 세대 검사 (종단간 암호화 6단계)
-- 설계: docs/exec-plans/active/team-lead-e2e-encryption.md (5.5절, 7.2절)
--
-- incremental_team_lead_e2e_plaintext_guard.sql의 트리거 함수를 바꾼다. 그 파일을 먼저 적용한 상태여야 한다.
-- 추가로 하는 일
--   1. 보호 대상 4개 key에는 현재 세대(crypto_meta_v1.currentKeyVersion) 열쇠로 잠근 암호문만 저장할 수 있다.
--      "열쇠 새로 고치기" 도중 예전 탭이 예전 열쇠로 덮어써서, 예전 열쇠 사본을 지운 뒤 아무도 못 여는 사고를 막는다.
--   2. crypto_meta_v1.currentKeyVersion은 줄일 수 없다.
--
-- 이것은 보안 장치가 아니라 데이터 보호 장치다. 데이터 내용은 읽지 않는다(형식만 본다). 여러 번 실행해도 안전하다.

create or replace function public.guard_team_lead_protected_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_enabled boolean;
  v_current_version integer;
begin
  if tg_op = 'DELETE' then
    if old.key = 'crypto_meta_v1' and coalesce(old.state -> 'enabled' = 'true'::jsonb, false) then
      raise exception using
        errcode = '22023',
        message = '총괄팀장 데이터 암호화 설정은 지울 수 없습니다.';
    end if;
    return old;
  end if;

  if new.key = 'crypto_meta_v1' then
    if tg_op = 'UPDATE'
      and coalesce(old.state -> 'enabled' = 'true'::jsonb, false)
      and not coalesce(new.state -> 'enabled' = 'true'::jsonb, false) then
      raise exception using
        errcode = '22023',
        message = '한 번 켠 총괄팀장 데이터 암호화는 끌 수 없습니다.';
    end if;
    if tg_op = 'UPDATE'
      and jsonb_typeof(old.state -> 'currentKeyVersion') = 'number'
      and (jsonb_typeof(new.state -> 'currentKeyVersion') is distinct from 'number'
        or (new.state ->> 'currentKeyVersion')::numeric < (old.state ->> 'currentKeyVersion')::numeric) then
      raise exception using
        errcode = '22023',
        message = '총괄팀장 데이터 열쇠 세대는 되돌릴 수 없습니다.';
    end if;
    return new;
  end if;

  if new.key not in ('scoreboard_v1', 'reference_notes_v1', 'contribution_manual_v1', 'best_report_quarters_v1') then
    return new;
  end if;

  select
    coalesce(state -> 'enabled' = 'true'::jsonb, false),
    case when jsonb_typeof(state -> 'currentKeyVersion') = 'number'
      then (state ->> 'currentKeyVersion')::numeric::integer end
  into v_enabled, v_current_version
  from public.team_lead_state
  where key = 'crypto_meta_v1';

  if not coalesce(v_enabled, false) then
    return new;
  end if;

  if jsonb_typeof(new.state) = 'object'
    and new.state ->> 'enc' = 'tl-e2e-v1'
    and jsonb_typeof(new.state -> 'keyVersion') = 'number'
    and jsonb_typeof(new.state -> 'iv') = 'string'
    and jsonb_typeof(new.state -> 'ct') = 'string' then
    if v_current_version is not null and (new.state ->> 'keyVersion')::numeric <> v_current_version then
      raise exception using
        errcode = '22023',
        message = '예전 열쇠로 잠근 데이터는 저장할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.';
    end if;
    return new;
  end if;

  raise exception using
    errcode = '22023',
    message = '보호 대상 총괄팀장 데이터는 암호문으로만 저장할 수 있습니다. 보안 열쇠 화면에서 이 기기를 연 뒤 다시 시도해 주세요.';
end;
$$;

drop trigger if exists guard_team_lead_protected_state on public.team_lead_state;

create trigger guard_team_lead_protected_state
before insert or update or delete on public.team_lead_state
for each row
execute function public.guard_team_lead_protected_state();
