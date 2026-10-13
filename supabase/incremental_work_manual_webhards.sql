-- Tips > 웹하드 계정 목록
-- 조회: 승인된 desk/team_lead/admin
-- 추가/수정/삭제: 승인된 desk/team_lead/admin

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.work_manual_webhards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  login_id text not null default '',
  password text not null default '',
  note text not null default '',
  url text not null default '',
  sort_order integer not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists work_manual_webhards_sort_order_idx
on public.work_manual_webhards (sort_order, created_at);

drop trigger if exists set_work_manual_webhards_updated_at on public.work_manual_webhards;
create trigger set_work_manual_webhards_updated_at
before update on public.work_manual_webhards
for each row
execute function public.set_updated_at();

alter table public.work_manual_webhards enable row level security;

drop policy if exists "work_manual_webhards_select_internal" on public.work_manual_webhards;
create policy "work_manual_webhards_select_internal"
on public.work_manual_webhards
for select
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

drop policy if exists "work_manual_webhards_manage_desk_admin" on public.work_manual_webhards;
create policy "work_manual_webhards_manage_desk_admin"
on public.work_manual_webhards
for all
to authenticated
using (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('desk', 'team_lead', 'admin')
  and public.current_profile_approved() = true
);

revoke all on table public.work_manual_webhards from anon;
grant select, insert, update, delete on table public.work_manual_webhards to authenticated, service_role;

notify pgrst, 'reload schema';
