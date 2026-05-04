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

create table if not exists public.portal_celebration_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text,
  button_label text not null default '확인하고 닫기',
  effect text not null default 'confetti',
  intensity text not null default 'normal',
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portal_celebration_events_effect_check
    check (effect in ('confetti')),
  constraint portal_celebration_events_intensity_check
    check (intensity in ('light', 'normal', 'strong')),
  constraint portal_celebration_events_date_range_check
    check (starts_at is null or ends_at is null or starts_at <= ends_at)
);

create index if not exists portal_celebration_events_active_created_at_idx
on public.portal_celebration_events (is_active, created_at desc);

drop trigger if exists set_portal_celebration_events_updated_at on public.portal_celebration_events;
create trigger set_portal_celebration_events_updated_at
before update on public.portal_celebration_events
for each row
execute function public.set_updated_at();

alter table public.portal_celebration_events enable row level security;

drop policy if exists "portal_celebration_events_select_current_active" on public.portal_celebration_events;
create policy "portal_celebration_events_select_current_active"
on public.portal_celebration_events
for select
to authenticated
using (
  is_active = true
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);

drop policy if exists "portal_celebration_events_admin_select_all" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_select_all"
on public.portal_celebration_events
for select
to authenticated
using (public.is_admin());

drop policy if exists "portal_celebration_events_admin_insert" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_insert"
on public.portal_celebration_events
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "portal_celebration_events_admin_update" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_update"
on public.portal_celebration_events
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "portal_celebration_events_admin_delete" on public.portal_celebration_events;
create policy "portal_celebration_events_admin_delete"
on public.portal_celebration_events
for delete
to authenticated
using (public.is_admin());
