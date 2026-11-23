-- 총괄팀장 보호 데이터 삭제 · 망가뜨리기 방지와 암호문 매일 백업 (종단간 암호화 보강)
-- 설계: docs/exec-plans/active/team-lead-e2e-encryption.md
--
-- 왜 필요한가
--   총괄팀장 비밀번호만 털려도(등록 기기 없이) RLS상 아래를 지우거나 덮어쓸 수 있었다.
--   내용은 못 봐도 데이터를 영영 못 열게 만들 수 있었다.
--     - 보호 데이터 4개 행 삭제
--     - 복구 코드 열쇠 · 그 사본(키 봉투) 삭제, 열쇠 값 바꿔치기
--     - 열쇠 세대를 아무도 사본이 없는 번호로 올리기
--   이 파일은 정상 화면 흐름(기기 해제, 복구 코드 다시 발급, 열쇠 새로 고치기, 팀장 강등)은 그대로 두고
--   위 행동만 DB에서 거부한다. 그리고 암호문을 매일 백업한다(암호문이라 개발자도 내용을 못 본다).
--
-- 먼저 적용해야 하는 파일: incremental_team_lead_e2e_keys.sql, incremental_team_lead_e2e_plaintext_guard.sql,
--   incremental_team_lead_e2e_key_version_guard.sql
-- 여러 번 실행해도 안전하다.
--
-- 백업에서 되살리기(개발자, 사고 때만):
--   select backed_up_at, payload from public.team_lead_protected_backups order by backed_up_at desc limit 5;
--   payload.state_rows의 key/state를 team_lead_state에 다시 넣는다. 열쇠 세대가 그 뒤 바뀌었으면
--   payload.recovery_envelopes도 team_lead_key_envelopes에 다시 넣어야 복구 코드로 열 수 있다.
--   되살리는 동안 이 파일의 트리거를 잠시 끄지 않아도 되도록 insert/upsert만 쓰면 된다.

-- 1) 암호화가 켜진 뒤에는 보호 데이터 4개 행을 지울 수 없다.
create or replace function public.block_team_lead_protected_state_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.key in ('scoreboard_v1', 'reference_notes_v1', 'contribution_manual_v1', 'best_report_quarters_v1')
    and exists (
      select 1 from public.team_lead_state
      where key = 'crypto_meta_v1' and coalesce(state -> 'enabled' = 'true'::jsonb, false)
    ) then
    raise exception using
      errcode = '22023',
      message = '암호화된 총괄팀장 데이터는 지울 수 없습니다.';
  end if;
  return old;
end;
$$;

drop trigger if exists block_team_lead_protected_state_delete on public.team_lead_state;
create trigger block_team_lead_protected_state_delete
before delete on public.team_lead_state
for each row
execute function public.block_team_lead_protected_state_delete();

-- 2) 열쇠 세대는 활성 복구 코드가 그 세대 사본을 가진 번호로만 올릴 수 있다.
--    (열쇠 새로 고치기는 사본을 먼저 만든 뒤 세대를 올리므로 그대로 동작한다.)
create or replace function public.guard_team_lead_key_version_bump()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_new integer;
begin
  if new.key <> 'crypto_meta_v1' or jsonb_typeof(new.state -> 'currentKeyVersion') is distinct from 'number' then
    return new;
  end if;
  v_new := (new.state ->> 'currentKeyVersion')::numeric::integer;
  if tg_op = 'UPDATE'
    and jsonb_typeof(old.state -> 'currentKeyVersion') = 'number'
    and v_new = (old.state ->> 'currentKeyVersion')::numeric::integer then
    return new;
  end if;
  if tg_op = 'INSERT' and not coalesce(new.state -> 'enabled' = 'true'::jsonb, false) then
    -- 최초 설정(아직 잠그기 전)은 복구 코드 사본과 같은 순서로 만들어진다.
    return new;
  end if;
  if not exists (
    select 1
    from public.team_lead_key_envelopes e
    join public.team_lead_key_holders h on h.id = e.holder_id
    where h.kind = 'recovery' and h.status = 'active' and e.key_version = v_new
  ) then
    raise exception using
      errcode = '22023',
      message = '복구 코드 사본이 없는 열쇠 세대로는 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_team_lead_key_version_bump on public.team_lead_state;
create trigger guard_team_lead_key_version_bump
before insert or update on public.team_lead_state
for each row
execute function public.guard_team_lead_key_version_bump();

-- 3) 열쇠 보관자: 열쇠 값은 바꿀 수 없고, 해제된 열쇠는 되살릴 수 없고,
--    암호화 설정 뒤에는 마지막 활성 복구 코드를 지우거나 해제할 수 없다(먼저 새 복구 코드를 발급해야 한다).
create or replace function public.guard_team_lead_key_holder_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind
      or new.profile_id is distinct from old.profile_id
      or new.public_key is distinct from old.public_key
      or new.fingerprint is distinct from old.fingerprint
      or new.wrapped_private_key is distinct from old.wrapped_private_key
      or new.kdf is distinct from old.kdf then
      raise exception using
        errcode = '22023',
        message = '등록된 열쇠 자체는 바꿀 수 없습니다. 해제하고 새로 등록해 주세요.';
    end if;
    if old.status = 'revoked' and new.status <> 'revoked' then
      raise exception using
        errcode = '22023',
        message = '해제한 열쇠는 다시 쓸 수 없습니다. 새로 등록해 주세요.';
    end if;
  end if;

  if old.kind = 'recovery'
    and old.status = 'active'
    and (tg_op = 'DELETE' or new.status <> 'active')
    and exists (select 1 from public.team_lead_state where key = 'crypto_meta_v1')
    and not exists (
      select 1 from public.team_lead_key_holders h
      where h.kind = 'recovery' and h.status = 'active' and h.id <> old.id
    ) then
    raise exception using
      errcode = '22023',
      message = '마지막 복구 코드는 지우거나 해제할 수 없습니다. 복구 코드 다시 발급을 이용해 주세요.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_team_lead_key_holder_change on public.team_lead_key_holders;
create trigger guard_team_lead_key_holder_change
before update or delete on public.team_lead_key_holders
for each row
execute function public.guard_team_lead_key_holder_change();

-- 4) 키 봉투: 현재 세대의 마지막 복구 코드 사본은 지우거나 바꿔치기할 수 없다.
--    (다시 발급은 새 복구 코드 사본을 먼저 만들고, 새로 고치기는 이전 세대만 지우므로 그대로 동작한다.)
create or replace function public.guard_team_lead_key_envelope_change()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_current integer;
begin
  select case when jsonb_typeof(state -> 'currentKeyVersion') = 'number'
    then (state ->> 'currentKeyVersion')::numeric::integer end
  into v_current
  from public.team_lead_state
  where key = 'crypto_meta_v1';

  if v_current is null
    or old.key_version <> v_current
    or not exists (
      select 1 from public.team_lead_key_holders h
      where h.id = old.holder_id and h.kind = 'recovery' and h.status = 'active'
    ) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    if new.holder_id is not distinct from old.holder_id
      and new.key_version is not distinct from old.key_version
      and new.wrapped_dek is not distinct from old.wrapped_dek then
      return new;
    end if;
    raise exception using
      errcode = '22023',
      message = '복구 코드 사본은 바꿀 수 없습니다.';
  end if;

  if not exists (
    select 1
    from public.team_lead_key_envelopes e
    join public.team_lead_key_holders h on h.id = e.holder_id
    where h.kind = 'recovery' and h.status = 'active' and e.key_version = v_current and e.holder_id <> old.holder_id
  ) then
    raise exception using
      errcode = '22023',
      message = '마지막 복구 코드 사본은 지울 수 없습니다. 복구 코드 다시 발급을 이용해 주세요.';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_team_lead_key_envelope_change on public.team_lead_key_envelopes;
create trigger guard_team_lead_key_envelope_change
before update or delete on public.team_lead_key_envelopes
for each row
execute function public.guard_team_lead_key_envelope_change();

-- 5) 암호문 매일 백업. 서버(service role) cron만 쓰고 읽는다. 화면 사용자는 접근할 수 없다.
--    백업에는 암호문, 암호화 설정, 활성 복구 코드의 사본만 넣는다(기기 사본은 넣지 않는다).
create table if not exists public.team_lead_protected_backups (
  id bigint generated always as identity primary key,
  backed_up_at timestamptz not null default timezone('utc', now()),
  payload jsonb not null
);

create index if not exists team_lead_protected_backups_backed_up_at_idx
  on public.team_lead_protected_backups (backed_up_at desc);

alter table public.team_lead_protected_backups enable row level security;
revoke all on table public.team_lead_protected_backups from public, anon, authenticated;
grant select, insert, delete on table public.team_lead_protected_backups to service_role;

create or replace function public.backup_team_lead_protected_state(p_keep_days integer default 35)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into public.team_lead_protected_backups (payload)
  select jsonb_build_object(
    'state_rows', coalesce((
      select jsonb_agg(jsonb_build_object('key', key, 'state', state, 'updated_at', updated_at) order by key)
      from public.team_lead_state
      where key in ('crypto_meta_v1', 'scoreboard_v1', 'reference_notes_v1', 'contribution_manual_v1', 'best_report_quarters_v1')
    ), '[]'::jsonb),
    'recovery_holders', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.created_at)
      from public.team_lead_key_holders h
      where h.kind = 'recovery' and h.status = 'active'
    ), '[]'::jsonb),
    'recovery_envelopes', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.key_version)
      from public.team_lead_key_envelopes e
      join public.team_lead_key_holders h on h.id = e.holder_id
      where h.kind = 'recovery' and h.status = 'active'
    ), '[]'::jsonb)
  );
  get diagnostics v_rows = row_count;

  delete from public.team_lead_protected_backups
  where backed_up_at < timezone('utc', now()) - make_interval(days => greatest(coalesce(p_keep_days, 35), 7));

  return v_rows;
end;
$$;

revoke all on function public.backup_team_lead_protected_state(integer) from public, anon, authenticated;
grant execute on function public.backup_team_lead_protected_state(integer) to service_role;
