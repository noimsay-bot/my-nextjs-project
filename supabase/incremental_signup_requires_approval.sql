-- 회원가입 승인제: 새로 가입한 계정은 관리자(총괄팀장 · admin)가 승인해야 쓸 수 있다.
--
-- 왜 필요한가
--   가입하면 바로 승인된 멤버가 되어, 인터넷의 누구나 가입만으로 총괄팀장 · DESK 이메일 명단 등
--   멤버 권한 데이터를 볼 수 있었다(맞춤형 피싱의 출발점).
--
-- 바뀌는 것
--   1. 새 가입자 프로필은 approved = false로 만든다(가입 트리거, 컬럼 기본값, 본인 프로필 생성 정책).
--   2. 승인 전에는 RLS상 본인 프로필 외에는 아무것도 볼 수 없다(기존 정책이 모두 approved를 본다).
--
-- 바뀌지 않는 것
--   기존 계정의 approved 값, 등급, 로그인. 이미 프로필이 있는 사람의 재로그인 · 프로필 보정.
--
-- 여러 번 실행해도 안전하다.

alter table public.profiles alter column approved set default false;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_name text;
  next_login_id text;
begin
  next_name := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''),
    split_part(new.email, '@', 1)
  );
  next_login_id := nullif(lower(trim(coalesce(new.raw_user_meta_data ->> 'login_id', ''))), '');

  insert into public.profiles (
    id,
    email,
    login_id,
    name,
    role,
    approved
  )
  values (
    new.id,
    new.email,
    next_login_id,
    next_name,
    'member'::public.app_role,
    -- 새 가입자는 관리자가 승인해야 쓸 수 있다.
    false
  )
  on conflict (id) do update
  set
    email = excluded.email,
    login_id = coalesce(excluded.login_id, public.profiles.login_id),
    name = coalesce(excluded.name, public.profiles.name),
    -- User-controlled metadata must never grant or change an existing role or approval.
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and role = 'member'
  and approved = false
);
