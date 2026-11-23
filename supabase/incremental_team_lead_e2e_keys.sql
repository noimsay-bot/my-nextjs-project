-- Purpose: 총괄팀장 데이터 종단간 암호화(1차)의 열쇠 보관 테이블.
--   설계: docs/exec-plans/active/team-lead-e2e-encryption.md (5절)
-- Impact:
--   - public.team_lead_key_holders(기기·복구 코드 보관자), public.team_lead_key_envelopes(보관자별로 감싼 데이터 키)를 만든다.
--   - 두 테이블 모두 승인된 team_lead만 접근한다. admin/desk/그 밖의 역할은 읽을 수 없다.
--   - profiles.role이 team_lead에서 다른 등급으로 바뀌면 그 사람의 기기 보관자를 revoked로 바꾸고 감싼 데이터 키를 지운다.
--   - 비밀값(평문 데이터 키, 기기 개인키, 복구 코드)은 어디에도 저장하지 않는다. 공개키와 감싼 값만 저장한다.
--   - 기존 테이블, 정책, 데이터는 바꾸지 않는다. 앱은 아직 이 테이블을 쓰지 않는다(P3부터 사용).
-- 보안 메모: 이 RLS는 실수 방지용이다. 보안은 암호에 달려 있다. RLS를 우회해도 감싼 데이터 키를 풀 개인키가 없다.
-- Rollback (P3 이후 실제 데이터가 생기면 롤백 시 열쇠를 잃으므로 주의):
--   drop trigger if exists revoke_team_lead_key_holders_on_demotion on public.profiles;
--   drop function if exists public.revoke_team_lead_key_holders_on_demotion();
--   drop table if exists public.team_lead_key_envelopes;
--   drop table if exists public.team_lead_key_holders;

create table if not exists public.team_lead_key_holders (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('device', 'recovery')),
  profile_id uuid references public.profiles (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 120),
  public_key text not null check (char_length(public_key) between 100 and 2000),
  fingerprint text not null check (fingerprint ~ '^[0-9]{6}$'),
  wrapped_private_key text,
  kdf jsonb,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint team_lead_key_holders_kind_shape check (
    (
      kind = 'device'
      and profile_id is not null
      and wrapped_private_key is null
      and kdf is null
    )
    or (
      kind = 'recovery'
      and profile_id is null
      and wrapped_private_key is not null
      and kdf is not null
    )
  ),
  constraint team_lead_key_holders_revoked_at check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index if not exists team_lead_key_holders_profile_idx
  on public.team_lead_key_holders (profile_id);

create index if not exists team_lead_key_holders_status_idx
  on public.team_lead_key_holders (status, kind);

drop trigger if exists set_team_lead_key_holders_updated_at on public.team_lead_key_holders;
create trigger set_team_lead_key_holders_updated_at
before update on public.team_lead_key_holders
for each row
execute function public.set_updated_at();

create table if not exists public.team_lead_key_envelopes (
  holder_id uuid not null references public.team_lead_key_holders (id) on delete cascade,
  key_version integer not null check (key_version >= 1),
  wrapped_dek text not null check (char_length(wrapped_dek) between 100 and 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (holder_id, key_version)
);

create index if not exists team_lead_key_envelopes_version_idx
  on public.team_lead_key_envelopes (key_version);

alter table public.team_lead_key_holders enable row level security;
alter table public.team_lead_key_envelopes enable row level security;

drop policy if exists "team_lead_key_holders_select_team_lead" on public.team_lead_key_holders;
create policy "team_lead_key_holders_select_team_lead"
on public.team_lead_key_holders
for select
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

-- 기기는 본인 것만 pending으로 등록한다. 복구 코드 보관자는 팀장이 바로 active로 만든다.
drop policy if exists "team_lead_key_holders_insert_team_lead" on public.team_lead_key_holders;
create policy "team_lead_key_holders_insert_team_lead"
on public.team_lead_key_holders
for insert
to authenticated
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
  and (
    (kind = 'device' and profile_id = auth.uid() and status = 'pending')
    or (kind = 'recovery' and status = 'active')
  )
);

drop policy if exists "team_lead_key_holders_update_team_lead" on public.team_lead_key_holders;
create policy "team_lead_key_holders_update_team_lead"
on public.team_lead_key_holders
for update
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_key_holders_delete_team_lead" on public.team_lead_key_holders;
create policy "team_lead_key_holders_delete_team_lead"
on public.team_lead_key_holders
for delete
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_key_envelopes_manage_team_lead" on public.team_lead_key_envelopes;
create policy "team_lead_key_envelopes_manage_team_lead"
on public.team_lead_key_envelopes
for all
to authenticated
using (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() = 'team_lead'
  and public.current_profile_approved() = true
);

revoke all on table public.team_lead_key_holders from anon;
revoke all on table public.team_lead_key_envelopes from anon;
grant select, insert, update, delete on table public.team_lead_key_holders to authenticated, service_role;
grant select, insert, update, delete on table public.team_lead_key_envelopes to authenticated, service_role;

-- team_lead에서 내려간 사람의 기기 열쇠를 자동으로 해제한다.
-- 앱 화면이 아닌 DB에서 처리하므로 어떤 경로로 등급을 바꿔도 적용된다.
create or replace function public.revoke_team_lead_key_holders_on_demotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'team_lead' and new.role is distinct from 'team_lead' then
    delete from public.team_lead_key_envelopes
    where holder_id in (
      select id
      from public.team_lead_key_holders
      where profile_id = new.id
        and kind = 'device'
    );

    update public.team_lead_key_holders
    set
      status = 'revoked',
      revoked_at = coalesce(revoked_at, timezone('utc', now()))
    where profile_id = new.id
      and kind = 'device'
      and status <> 'revoked';
  end if;

  return new;
end;
$$;

revoke execute on function public.revoke_team_lead_key_holders_on_demotion() from public, anon, authenticated;

drop trigger if exists revoke_team_lead_key_holders_on_demotion on public.profiles;
create trigger revoke_team_lead_key_holders_on_demotion
after update of role on public.profiles
for each row
execute function public.revoke_team_lead_key_holders_on_demotion();
