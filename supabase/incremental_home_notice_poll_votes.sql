-- Purpose: Store home notice poll votes outside the all-approved-readable notice JSON.

create table if not exists public.home_notice_poll_votes (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null,
  poll_id uuid not null,
  option_id uuid not null,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  voter_name text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists home_notice_poll_votes_notice_poll_idx
  on public.home_notice_poll_votes (notice_id, poll_id, created_at desc);
create index if not exists home_notice_poll_votes_option_idx
  on public.home_notice_poll_votes (notice_id, poll_id, option_id);
create index if not exists home_notice_poll_votes_voter_idx
  on public.home_notice_poll_votes (voter_id, created_at desc);
create unique index if not exists home_notice_poll_votes_once_uidx
  on public.home_notice_poll_votes (notice_id, poll_id, voter_id);

alter table public.home_notice_poll_votes enable row level security;

drop policy if exists "home_notice_poll_votes_select_own" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_select_own"
on public.home_notice_poll_votes
for select
to authenticated
using (
  voter_id = auth.uid()
  and public.current_profile_approved() = true
);

drop policy if exists "home_notice_poll_votes_insert_own" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_insert_own"
on public.home_notice_poll_votes
for insert
to authenticated
with check (
  voter_id = auth.uid()
  and public.current_profile_approved() = true
  and public.current_profile_role() <> 'observer'
);

drop policy if exists "home_notice_poll_votes_delete_privileged" on public.home_notice_poll_votes;
create policy "home_notice_poll_votes_delete_privileged"
on public.home_notice_poll_votes
for delete
to authenticated
using (
  public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and public.current_profile_approved() = true
);

revoke all on table public.home_notice_poll_votes from anon;
grant select, insert, delete on table public.home_notice_poll_votes to authenticated;
grant select, insert, update, delete on table public.home_notice_poll_votes to service_role;
