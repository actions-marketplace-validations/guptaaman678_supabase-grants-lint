alter default privileges for role postgres in schema public
  grant select on tables to anon;
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  event text not null
);
grant select, insert on public.audit_log to service_role;
