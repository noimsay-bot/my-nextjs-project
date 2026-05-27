-- Purpose: Allow DESK users to return borrowed equipment for any borrower.
-- Impact: Borrowers can still return their own items; desk/team_lead/admin can process returns for all borrowed equipment.

drop policy if exists "equipment_loans_update_own_or_admin" on public.equipment_loans;
create policy "equipment_loans_update_own_or_admin"
on public.equipment_loans
for update
to authenticated
using (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
)
with check (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or (
    public.current_profile_approved() = true
    and public.current_profile_role() <> 'observer'
    and borrower_profile_id = auth.uid()
  )
);

drop policy if exists "equipment_loan_items_update_own_or_admin" on public.equipment_loan_items;
create policy "equipment_loan_items_update_own_or_admin"
on public.equipment_loan_items
for update
to authenticated
using (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
)
with check (
  (
    public.current_profile_approved() = true
    and public.current_profile_role() in ('desk', 'admin', 'team_lead')
  )
  or exists (
    select 1
    from public.equipment_loans
    where equipment_loans.id = equipment_loan_items.loan_id
      and equipment_loans.borrower_profile_id = auth.uid()
      and public.current_profile_approved() = true
      and public.current_profile_role() <> 'observer'
  )
);

create or replace function public.return_equipment_loan_items(
  p_loan_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := timezone('utc', now());
  v_returned_count integer := 0;
  v_loan_ids uuid[] := array[]::uuid[];
  v_returned_item_ids uuid[] := array[]::uuid[];
begin
  if v_user_id is null then
    raise exception '승인된 로그인 세션이 필요합니다.';
  end if;

  if public.current_profile_approved() is distinct from true
     or public.current_profile_role() = 'observer' then
    raise exception '장비 반납 권한이 없습니다.';
  end if;

  with requested_items as (
    select distinct loan_item_id
    from unnest(coalesce(p_loan_item_ids, array[]::uuid[])) as loan_item_id
  ),
  updated_items as (
    update public.equipment_loan_items
    set
      status = 'returned',
      returned_at = v_now
    from public.equipment_loans
    where equipment_loan_items.loan_id = equipment_loans.id
      and equipment_loan_items.id in (select loan_item_id from requested_items)
      and equipment_loan_items.status = 'borrowed'
      and (
        equipment_loans.borrower_profile_id = v_user_id
        or public.current_profile_role() in ('desk', 'admin', 'team_lead')
      )
    returning equipment_loan_items.loan_id, equipment_loan_items.equipment_item_id
  )
  select
    count(*),
    coalesce(array_agg(distinct loan_id), array[]::uuid[]),
    coalesce(array_agg(distinct equipment_item_id), array[]::uuid[])
  into v_returned_count, v_loan_ids, v_returned_item_ids
  from updated_items;

  update public.equipment_loans
  set
    status = 'returned',
    returned_at = v_now
  where id = any(v_loan_ids)
    and not exists (
      select 1
      from public.equipment_loan_items
      where equipment_loan_items.loan_id = equipment_loans.id
        and equipment_loan_items.status = 'borrowed'
    );

  delete from public.live_equipment_status_board
  where equipment_item_id = any(v_returned_item_ids);

  return coalesce(v_returned_count, 0);
end;
$$;

revoke execute on function public.return_equipment_loan_items(uuid[]) from public, anon;
grant execute on function public.return_equipment_loan_items(uuid[]) to authenticated;
