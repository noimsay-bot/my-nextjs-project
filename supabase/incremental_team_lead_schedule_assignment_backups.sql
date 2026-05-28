-- Purpose: Store schedule assignment daily backups in Supabase with 10-day retention.
-- Impact: Adds public.team_lead_schedule_assignment_backups for desk/team_lead/admin users.
-- Rollback: DROP TABLE public.team_lead_schedule_assignment_backups;

create table if not exists public.team_lead_schedule_assignment_backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'daily' check (kind in ('daily')),
  month_key text not null,
  backup_date date not null,
  label text not null default '',
  entries jsonb not null default '{}'::jsonb,
  rows jsonb not null default '{}'::jsonb,
  entry_count integer not null default 0 check (entry_count >= 0),
  row_change_count integer not null default 0 check (row_change_count >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint team_lead_schedule_assignment_backups_daily_unique unique (kind, month_key, backup_date)
);

create index if not exists team_lead_schedule_assignment_backups_month_date_idx
on public.team_lead_schedule_assignment_backups (month_key, backup_date desc);

drop trigger if exists set_team_lead_schedule_assignment_backups_updated_at on public.team_lead_schedule_assignment_backups;

create trigger set_team_lead_schedule_assignment_backups_updated_at
before update on public.team_lead_schedule_assignment_backups
for each row
execute function public.set_updated_at();

create or replace function public.prune_team_lead_schedule_assignment_backups()
returns trigger
language plpgsql
as $$
begin
  delete from public.team_lead_schedule_assignment_backups backups
  where backups.kind = new.kind
    and backups.month_key = new.month_key
    and backups.backup_date < new.backup_date - 9;

  delete from public.team_lead_schedule_assignment_backups backups
  where backups.id in (
    select ranked.id
    from (
      select
        id,
        row_number() over (
          partition by kind, month_key
          order by backup_date desc, updated_at desc, id desc
        ) as backup_rank
      from public.team_lead_schedule_assignment_backups
      where kind = new.kind
        and month_key = new.month_key
    ) ranked
    where ranked.backup_rank > 10
  );

  return new;
end;
$$;

drop trigger if exists prune_team_lead_schedule_assignment_backups on public.team_lead_schedule_assignment_backups;

create trigger prune_team_lead_schedule_assignment_backups
after insert or update on public.team_lead_schedule_assignment_backups
for each row
execute function public.prune_team_lead_schedule_assignment_backups();

alter table public.team_lead_schedule_assignment_backups enable row level security;

drop policy if exists "team_lead_schedule_assignment_backups_select_managers" on public.team_lead_schedule_assignment_backups;
create policy "team_lead_schedule_assignment_backups_select_managers"
on public.team_lead_schedule_assignment_backups
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "team_lead_schedule_assignment_backups_manage_privileged" on public.team_lead_schedule_assignment_backups;
create policy "team_lead_schedule_assignment_backups_manage_privileged"
on public.team_lead_schedule_assignment_backups
for all
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
)
with check (
  public.current_profile_role() in ('team_lead', 'admin', 'desk')
  and public.current_profile_approved() = true
);

revoke all on table public.team_lead_schedule_assignment_backups from anon;
grant select, insert, update, delete on table public.team_lead_schedule_assignment_backups to authenticated, service_role;
