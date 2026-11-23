-- 총괄팀장 보호 데이터 평문 덮어쓰기 방지 (종단간 암호화 5단계)
-- 설계: docs/exec-plans/active/team-lead-e2e-encryption.md (5.5절)
--
-- 하는 일
--   1. crypto_meta_v1.enabled = true이면 보호 대상 4개 key(점수판·참고사항·기여도·분기 결과)에
--      암호문 envelope(enc = 'tl-e2e-v1') 형식이 아닌 값을 쓰는 것을 거부한다.
--   2. 한 번 켠 crypto_meta_v1.enabled를 false로 되돌리거나 지우는 것을 거부한다.
--
-- 이것은 보안 장치가 아니라 데이터 보호 장치다. 잠긴 브라우저나 예전 코드가
-- 평문 또는 빈 값으로 암호문을 덮어써서 데이터가 사라지는 사고를 막는다.
-- 데이터 내용은 읽지 않는다(형식만 본다). 여러 번 실행해도 안전하다.

create or replace function public.guard_team_lead_protected_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_enabled boolean;
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
    return new;
  end if;

  if new.key not in ('scoreboard_v1', 'reference_notes_v1', 'contribution_manual_v1', 'best_report_quarters_v1') then
    return new;
  end if;

  select coalesce(state -> 'enabled' = 'true'::jsonb, false)
  into v_enabled
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
