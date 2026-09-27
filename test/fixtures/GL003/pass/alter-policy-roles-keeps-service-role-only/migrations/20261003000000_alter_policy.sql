-- Changing only the roles keeps the service_role test, so the policy still admits no client.
alter policy "service role only" on public.messages to anon, authenticated;
