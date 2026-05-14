create table if not exists public.customer_support_messages (
  id uuid primary key default gen_random_uuid(),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'processed')),
  processed_at timestamptz,
  processed_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.customer_support_messages
add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.customer_support_messages
add column if not exists status text not null default 'open';

alter table public.customer_support_messages
add column if not exists processed_at timestamptz;

alter table public.customer_support_messages
add column if not exists processed_by uuid references public.profiles (id) on delete set null;

alter table public.customer_support_messages
add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.customer_support_messages
drop constraint if exists customer_support_messages_status_check;

alter table public.customer_support_messages
add constraint customer_support_messages_status_check
check (status in ('open', 'processed'));

create index if not exists customer_support_messages_created_at_idx
on public.customer_support_messages (created_at desc);

create index if not exists customer_support_messages_status_created_at_idx
on public.customer_support_messages (status, created_at desc);

drop trigger if exists set_customer_support_messages_updated_at on public.customer_support_messages;
create trigger set_customer_support_messages_updated_at
before update on public.customer_support_messages
for each row
execute function public.set_updated_at();

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

drop policy if exists "customer_support_messages_update_admins" on public.customer_support_messages;
create policy "customer_support_messages_update_admins"
on public.customer_support_messages
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'customer-support-attachments',
  'customer-support-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

drop policy if exists "customer_support_attachments_insert_approved" on storage.objects;
create policy "customer_support_attachments_insert_approved"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customer-support-attachments'
  and public.current_profile_approved() = true
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "customer_support_attachments_select_admins" on storage.objects;
create policy "customer_support_attachments_select_admins"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customer-support-attachments'
  and public.is_admin()
);

drop policy if exists "customer_support_attachments_delete_own" on storage.objects;
create policy "customer_support_attachments_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-support-attachments'
  and public.current_profile_approved() = true
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.mark_customer_support_message_processed(
  p_message_id uuid
)
returns public.customer_support_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.customer_support_messages;
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.is_admin() is distinct from true then
    raise exception '고객센터 접수 내용 처리 권한이 없습니다.';
  end if;

  update public.customer_support_messages
  set
    status = 'processed',
    processed_at = timezone('utc', now()),
    processed_by = v_user_id
  where id = p_message_id
  returning * into v_row;

  if v_row.id is null then
    raise exception '처리할 고객센터 접수 내용을 찾을 수 없습니다.';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.mark_customer_support_message_processed(uuid) from public, anon;
grant execute on function public.mark_customer_support_message_processed(uuid) to authenticated;
