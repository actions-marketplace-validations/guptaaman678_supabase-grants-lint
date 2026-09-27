-- The OR admits authenticated users too, so this is client access control and needs a grant.
create policy "service role or owner" on public.messages for select to authenticated
  using (auth.role() = 'service_role' or auth.uid() = user_id);
