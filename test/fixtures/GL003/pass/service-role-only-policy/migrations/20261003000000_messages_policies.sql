create policy "service role reads messages" on public.messages for select
  using (current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role');
create policy "service role writes messages" on public.messages for update
  using (current_user = 'service_role') with check ('service_role' = (select auth.role()));
