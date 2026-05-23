create or replace function public.current_profile_has_review_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_profile_approved() = true
    and exists (
      select 1
      from public.team_lead_state
      where public.team_lead_state.key = 'review_access_v1'
        and coalesce(public.team_lead_state.state -> 'profileIds', '[]'::jsonb) @> to_jsonb(array[auth.uid()::text])
    )
  );
$$;

grant execute on function public.current_profile_has_review_access() to authenticated;

drop policy if exists "submissions_select_assigned_reviewer" on public.submissions;
drop policy if exists "reviews_insert_assigned_reviewer" on public.reviews;
drop policy if exists "reviews_update_assigned_reviewer" on public.reviews;
