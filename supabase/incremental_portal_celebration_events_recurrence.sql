-- Purpose: Add yearly recurrence support for celebration banner events.
-- Impact: Adds recurrence metadata and updates the current-active select policy.
-- Apply in Supabase SQL Editor before deploying code that writes recurrence.

alter table public.portal_celebration_events
  add column if not exists recurrence text not null default 'none';

alter table public.portal_celebration_events
  drop constraint if exists portal_celebration_events_recurrence_check;

alter table public.portal_celebration_events
  add constraint portal_celebration_events_recurrence_check
  check (recurrence in ('none', 'yearly'));

drop policy if exists "portal_celebration_events_select_current_active" on public.portal_celebration_events;
create policy "portal_celebration_events_select_current_active"
on public.portal_celebration_events
for select
to authenticated
using (
  is_active = true
  and (
    (
      recurrence = 'none'
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    )
    or (
      recurrence = 'yearly'
      and starts_at is not null
      and starts_at <= now()
      and (
        (
          ends_at is null
          and to_char(timezone('Asia/Seoul', now()), 'MMDD') = to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
        )
        or (
          ends_at is not null
          and (
            (
              to_char(timezone('Asia/Seoul', starts_at), 'MMDD') <= to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              and to_char(timezone('Asia/Seoul', now()), 'MMDD')
                between to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
                and to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
            )
            or (
              to_char(timezone('Asia/Seoul', starts_at), 'MMDD') > to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              and (
                to_char(timezone('Asia/Seoul', now()), 'MMDD') >= to_char(timezone('Asia/Seoul', starts_at), 'MMDD')
                or to_char(timezone('Asia/Seoul', now()), 'MMDD') <= to_char(timezone('Asia/Seoul', ends_at), 'MMDD')
              )
            )
          )
        )
      )
    )
  )
);
