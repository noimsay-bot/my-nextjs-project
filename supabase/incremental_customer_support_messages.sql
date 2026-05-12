create table if not exists public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists customer_support_messages_created_at_idx
on public.customer_support_messages (created_at desc);

alter table public.customer_support_messages enable row level security;

drop policy if exists "customer_support_messages_insert_approved" on public.customer_support_messages;
create policy "customer_support_messages_insert_approved"
on public.customer_support_messages
for insert
to authenticated
with check (public.current_profile_approved() = true);

drop policy if exists "customer_support_messages_select_admins" on public.customer_support_messages;
create policy "customer_support_messages_select_admins"
on public.customer_support_messages
for select
to authenticated
using (public.is_admin());
