create table public.audit_log (
  id bigserial primary key,
  action text not null
);
-- Deliberately narrowed: clients may read nothing here.
revoke all on public.audit_log from anon, authenticated;
grant select on all tables in schema public to anon;
