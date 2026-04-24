drop policy if exists "submissions_insert_own" on public.submissions;
create policy "submissions_insert_own"
on public.submissions
for insert
to authenticated
with check (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "submissions_update_own" on public.submissions;
create policy "submissions_update_own"
on public.submissions
for update
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
)
with check (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "submissions_delete_own" on public.submissions;
create policy "submissions_delete_own"
on public.submissions
for delete
to authenticated
using (
  author_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "home_popup_notice_applications_insert_own" on public.home_popup_notice_applications;
create policy "home_popup_notice_applications_insert_own"
on public.home_popup_notice_applications
for insert
to authenticated
with check (
  applicant_id = auth.uid()
  and public.current_profile_approved() = true
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "vacation_requests_insert_own" on public.vacation_requests;
create policy "vacation_requests_insert_own"
on public.vacation_requests
for insert
to authenticated
with check (
  requester_id = auth.uid()
  and public.current_profile_approved() = true
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "vacation_requests_update_own" on public.vacation_requests;
create policy "vacation_requests_update_own"
on public.vacation_requests
for update
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
)
with check (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);

drop policy if exists "vacation_requests_delete_own" on public.vacation_requests;
create policy "vacation_requests_delete_own"
on public.vacation_requests
for delete
to authenticated
using (
  requester_id = auth.uid()
  and public.current_profile_role() not in ('advisor', 'observer')
);
