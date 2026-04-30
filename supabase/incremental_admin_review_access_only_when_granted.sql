drop policy if exists "submissions_select_reviewers_and_leads" on public.submissions;
create policy "submissions_select_reviewers_and_leads"
on public.submissions
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'desk')
  and public.current_profile_approved() = true
);

drop policy if exists "reviews_select_privileged" on public.reviews;
create policy "reviews_select_privileged"
on public.reviews
for select
to authenticated
using (
  public.current_profile_role() in ('team_lead', 'desk')
  and public.current_profile_approved() = true
);

create or replace function public.current_profile_has_review_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    public.current_profile_approved() = true
    and (
      public.current_profile_role() in ('reviewer', 'team_lead', 'desk')
      or exists (
        select 1
        from public.team_lead_state
        where public.team_lead_state.key = 'review_access_v1'
          and coalesce(public.team_lead_state.state -> 'profileIds', '[]'::jsonb) @> to_jsonb(array[auth.uid()::text])
      )
    )
  );
$$;
