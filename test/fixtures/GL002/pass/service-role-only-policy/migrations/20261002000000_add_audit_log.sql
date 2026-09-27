create table public.audit_log (
  id bigint generated always as identity primary key,
  action text not null
);
alter table public.audit_log enable row level security;
grant select, insert on public.audit_log to service_role;
-- No TO clause, so the policies are for PUBLIC, but they only admit service_role (which bypasses
-- RLS anyway): the author means "no client access", and no client grant is expected.
create policy "Service role only" on public.audit_log for all using (auth.role() = 'service_role');
create policy "Service role inserts" on public.audit_log for insert to public
  with check ((select auth.jwt() ->> 'role') = 'service_role'::text);
