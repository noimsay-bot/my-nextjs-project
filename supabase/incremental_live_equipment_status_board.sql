create table if not exists public.live_equipment_status_board (
  equipment_item_id uuid primary key references public.equipment_items (id) on delete cascade,
  live_trs text,
  live_camera_reporter text,
  live_audio_man text,
  live_location text,
  live_note text,
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_live_equipment_status_board_updated_at on public.live_equipment_status_board;
create trigger set_live_equipment_status_board_updated_at
before update on public.live_equipment_status_board
for each row
execute function public.set_updated_at();

alter table public.live_equipment_status_board enable row level security;

drop policy if exists "live_equipment_status_board_select_approved" on public.live_equipment_status_board;
create policy "live_equipment_status_board_select_approved"
on public.live_equipment_status_board
for select
to authenticated
using (public.current_profile_approved() = true);

drop policy if exists "live_equipment_status_board_insert_privileged" on public.live_equipment_status_board;
create policy "live_equipment_status_board_insert_privileged"
on public.live_equipment_status_board
for insert
to authenticated
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and updated_by = auth.uid()
);

revoke all on table public.live_equipment_status_board from anon;
grant select, insert, update on table public.live_equipment_status_board to authenticated;
grant select, insert, update, delete on table public.live_equipment_status_board to service_role;

drop policy if exists "live_equipment_status_board_update_privileged" on public.live_equipment_status_board;
create policy "live_equipment_status_board_update_privileged"
on public.live_equipment_status_board
for update
to authenticated
using (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
)
with check (
  public.current_profile_approved() = true
  and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  and updated_by = auth.uid()
);
