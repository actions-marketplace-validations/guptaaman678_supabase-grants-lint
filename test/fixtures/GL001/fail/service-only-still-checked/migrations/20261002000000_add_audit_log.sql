create table public.audit_log (
  id bigint generated always as identity primary key,
  action text not null
);
alter table public.audit_log enable row level security;
