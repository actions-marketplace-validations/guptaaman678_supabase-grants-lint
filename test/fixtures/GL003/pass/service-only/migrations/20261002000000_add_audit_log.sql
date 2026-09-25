create table public.audit_log (
  id bigint generated always as identity primary key,
  action text not null
);
alter table public.audit_log enable row level security;
grant select, insert on public.audit_log to service_role;
grant insert on public.audit_log to authenticated;
create policy "members read own audit rows" on public.audit_log for select to authenticated using (false);
