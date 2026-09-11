-- Atomic news composition/publication and live equipment board writes.
-- Apply this file in Supabase SQL Editor BEFORE deploying its RPC callers.
-- Does not create/change existing tables or RLS. News issue tables must already
-- exist in environments using the issue-set feature (their DDL is not in this repo).
-- Invoker functions preserve table permissions/RLS; equipment RPC is server-only.

begin;

create or replace function public.save_news_issue_set_items_atomic(
  p_issue_set_id uuid, p_briefing_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_set record;
  v_count integer;
begin
  if auth.uid() is null or public.is_admin() is distinct from true then
    raise exception '발행 세트 관리자 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_briefing_ids is null or cardinality(p_briefing_ids) > 3
     or exists (select 1 from unnest(p_briefing_ids) id where id is null)
     or cardinality(p_briefing_ids) <> (select count(distinct id) from unnest(p_briefing_ids) id) then
    raise exception '발행 세트에는 중복 없이 최대 3개까지만 담을 수 있습니다.' using errcode = '22023';
  end if;
  select id, status into v_set from public.home_news_issue_sets
    where id = p_issue_set_id for update;
  if not found then
    raise exception '발행 세트를 찾지 못했습니다.';
  end if;
  if v_set.status <> 'draft' then
    raise exception '초안 상태의 발행 세트만 구성할 수 있습니다.';
  end if;
  delete from public.home_news_issue_set_items where issue_set_id = p_issue_set_id;
  -- A restrictive DELETE policy must not silently preserve hidden items.
  if exists (select 1 from public.home_news_issue_set_items where issue_set_id = p_issue_set_id) then
    raise exception '발행 세트 구성 삭제 권한이 없습니다.' using errcode = '42501';
  end if;
  insert into public.home_news_issue_set_items (issue_set_id, briefing_id, display_order)
    select p_issue_set_id, id, ord::integer from unnest(p_briefing_ids) with ordinality as ids(id, ord);
  update public.home_news_issue_sets set updated_by = auth.uid() where id = p_issue_set_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception '발행 세트 저장 권한이 없습니다.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.publish_news_issue_set_atomic(p_issue_set_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_set record;
  v_count integer;
  v_expected integer;
begin
  if auth.uid() is null or public.is_admin() is distinct from true then
    raise exception '발행 세트 관리자 권한이 없습니다.' using errcode = '42501';
  end if;
  -- Serialize publishers before row locks: two drafts for the same slot must
  -- not both become official. Composition uses the same target row lock.
  perform pg_advisory_xact_lock(728410, 1);
  select id, status, issue_date, briefing_slot into v_set
    from public.home_news_issue_sets where id = p_issue_set_id for update;
  if not found then
    raise exception '발행 세트를 찾지 못했습니다.';
  end if;
  if v_set.status not in ('draft', 'published') then
    raise exception '잠금되거나 보관된 발행 세트는 다시 발행할 수 없습니다.';
  end if;
  if (select count(*) from public.home_news_issue_set_items where issue_set_id = p_issue_set_id) > 3 then
    raise exception '발행 세트에는 최대 3개까지만 담을 수 있습니다.';
  end if;
  perform id from public.home_news_issue_sets
    where issue_date = v_set.issue_date and briefing_slot = v_set.briefing_slot
      and id <> p_issue_set_id and status in ('published', 'locked')
    order by id for update;
  select count(*) into v_expected from public.home_news_issue_sets
    where issue_date = v_set.issue_date and briefing_slot = v_set.briefing_slot
      and id <> p_issue_set_id and status in ('published', 'locked');
  update public.home_news_issue_sets set status = 'archived', updated_by = auth.uid()
    where issue_date = v_set.issue_date and briefing_slot = v_set.briefing_slot
      and id <> p_issue_set_id and status in ('published', 'locked');
  get diagnostics v_count = row_count;
  if v_count <> v_expected then
    raise exception '기존 발행 세트 보관 권한이 없습니다.' using errcode = '42501';
  end if;
  update public.home_news_issue_sets
    set status = 'published', published_at = now(), updated_by = auth.uid()
    where id = p_issue_set_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception '발행 세트 저장 권한이 없습니다.' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.save_live_equipment_status_atomic(p_actor_id uuid, p_entries jsonb)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_item record;
  v_loan_id uuid;
  v_now timestamptz := now();
  v_borrowable boolean;
  v_has_content boolean;
  v_updated uuid[] := array[]::uuid[];
  v_returned uuid[] := array[]::uuid[];
  v_initial_loans jsonb;
begin
  -- EXECUTE is service_role-only. The API resolves actor_id from getUser(),
  -- never request JSON; recheck the actor's current approval and role here.
  if not exists (select 1 from public.profiles
    where id = p_actor_id and approved = true and role in ('desk', 'team_lead', 'admin')) then
    raise exception '라이브장비 현황판 저장 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception '장비 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_entries) = 0 or jsonb_array_length(p_entries) > 1000 then
    raise exception '저장할 장비 목록의 크기가 올바르지 않습니다.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e) <> 'object') then
    raise exception '장비 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_entries) as e(
      equipment_item_id uuid, live_trs text, live_camera_reporter text,
      live_audio_man text, live_location text, live_note text)
    where equipment_item_id is null or length(live_trs) > 120
      or length(live_camera_reporter) > 120 or length(live_audio_man) > 120
      or length(live_location) > 160 or length(live_note) > 240
  ) or (select count(distinct e.equipment_item_id)
    from jsonb_to_recordset(p_entries) as e(equipment_item_id uuid)) <> jsonb_array_length(p_entries) then
    raise exception '중복되거나 올바르지 않은 장비 현황입니다.' using errcode = '22023';
  end if;
  if exists (
    select trim(trs) from jsonb_to_recordset(p_entries) as e(equipment_item_id uuid, live_trs text)
      cross join lateral unnest(string_to_array(e.live_trs, ',')) trs
    where trim(trs) <> '' group by trim(trs) having count(distinct e.equipment_item_id) > 1
  ) then
    raise exception '이미 다른 라이브장비에 입력된 TRS입니다.' using errcode = '22023';
  end if;

  -- Existing borrow/return RPCs do not take an advisory lock. Table write locks
  -- also serialize those paths; readers are unaffected. A deadlock/timeout aborts
  -- the entire request instead of leaving a partially returned parent/child.
  lock table public.equipment_loans, public.equipment_loan_items,
    public.live_equipment_status_board in share row exclusive mode;
  perform i.id from public.equipment_items i
    join jsonb_to_recordset(p_entries) as e(equipment_item_id uuid) on e.equipment_item_id = i.id
    order by i.id for update of i;
  if (select count(*) from public.equipment_items i
    join jsonb_to_recordset(p_entries) as e(equipment_item_id uuid) on e.equipment_item_id = i.id)
    <> jsonb_array_length(p_entries) then
    raise exception '존재하지 않는 장비가 포함되어 있습니다.' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(li.equipment_item_id::text, li.loan_id::text), '{}'::jsonb)
    into v_initial_loans
    from public.equipment_loan_items li join public.equipment_loans l on l.id = li.loan_id
    where li.status = 'borrowed' and l.status = 'borrowed'
      and li.equipment_item_id in (select e.equipment_item_id
        from jsonb_to_recordset(p_entries) as e(equipment_item_id uuid));
  for v_entry in
    select * from jsonb_to_recordset(p_entries) as e(
      equipment_item_id uuid, live_trs text, live_camera_reporter text,
      live_audio_man text, live_location text, live_note text)
  loop
    select is_active, metadata into v_item from public.equipment_items where id = v_entry.equipment_item_id;
    v_borrowable := coalesce(v_item.is_active, false)
      and coalesce(v_item.metadata ->> 'is_under_repair', 'false') <> 'true'
      and coalesce(v_item.metadata ->> 'borrowable', 'true') <> 'false';
    v_has_content := coalesce(v_entry.live_trs, '') <> '' or coalesce(v_entry.live_camera_reporter, '') <> ''
      or coalesce(v_entry.live_audio_man, '') <> '' or coalesce(v_entry.live_location, '') <> ''
      or coalesce(v_entry.live_note, '') <> '';
    v_loan_id := (v_initial_loans ->> v_entry.equipment_item_id::text)::uuid;
    if not v_borrowable then
      if v_has_content then
        insert into public.live_equipment_status_board (
          equipment_item_id, live_trs, live_camera_reporter, live_audio_man, live_location, live_note, updated_by)
        values (v_entry.equipment_item_id, v_entry.live_trs, v_entry.live_camera_reporter,
          v_entry.live_audio_man, v_entry.live_location, v_entry.live_note, p_actor_id)
        on conflict (equipment_item_id) do update set
          live_trs = excluded.live_trs, live_camera_reporter = excluded.live_camera_reporter,
          live_audio_man = excluded.live_audio_man, live_location = excluded.live_location,
          live_note = excluded.live_note, updated_by = excluded.updated_by;
      else
        delete from public.live_equipment_status_board where equipment_item_id = v_entry.equipment_item_id;
      end if;
      continue;
    end if;

    if not v_has_content then
      if v_loan_id is not null and not (v_loan_id = any(v_returned)) then
        update public.equipment_loan_items set status = 'returned', returned_at = v_now
          where loan_id = v_loan_id and status = 'borrowed';
        update public.equipment_loans set status = 'returned', returned_at = v_now where id = v_loan_id;
        v_returned := array_append(v_returned, v_loan_id);
      end if;
    elsif v_loan_id is null then
      insert into public.equipment_loans (
        borrower_profile_id, borrowed_at, status, loan_type, live_trs,
        live_camera_reporter, live_audio_man, live_location, live_note)
      values (p_actor_id, v_now, 'borrowed', 'live', v_entry.live_trs,
        v_entry.live_camera_reporter, v_entry.live_audio_man, v_entry.live_location, v_entry.live_note)
      returning id into v_loan_id;
      insert into public.equipment_loan_items (loan_id, equipment_item_id, borrowed_at, status)
        values (v_loan_id, v_entry.equipment_item_id, v_now, 'borrowed');
      v_updated := array_append(v_updated, v_loan_id);
    elsif not (v_loan_id = any(v_updated)) then
      update public.equipment_loans set live_trs = v_entry.live_trs,
        live_camera_reporter = v_entry.live_camera_reporter, live_audio_man = v_entry.live_audio_man,
        live_location = v_entry.live_location, live_note = v_entry.live_note
        where id = v_loan_id and status = 'borrowed';
      v_updated := array_append(v_updated, v_loan_id);
    end if;
    delete from public.live_equipment_status_board where equipment_item_id = v_entry.equipment_item_id;
  end loop;
end;
$$;

revoke all on function public.save_news_issue_set_items_atomic(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.publish_news_issue_set_atomic(uuid) from public, anon, service_role;
grant execute on function public.save_news_issue_set_items_atomic(uuid, uuid[]) to authenticated;
grant execute on function public.publish_news_issue_set_atomic(uuid) to authenticated;
revoke all on function public.save_live_equipment_status_atomic(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_live_equipment_status_atomic(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';

commit;
