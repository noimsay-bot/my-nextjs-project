begin;

delete from public.vacation_requests;

update public.vacation_months
set
  annual_winners = '{}'::jsonb,
  compensatory_winners = '{}'::jsonb,
  applied_at = null,
  updated_at = timezone('utc', now());

commit;
