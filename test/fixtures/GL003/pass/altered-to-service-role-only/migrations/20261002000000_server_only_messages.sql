-- Clients lose access, and both expressions now only test for service_role, so the altered policy
-- admits no client and needs no client grant.
revoke all on public.messages from anon, authenticated;
alter policy "edit own messages" on public.messages
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
