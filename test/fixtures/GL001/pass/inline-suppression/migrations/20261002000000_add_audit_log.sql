-- grants-lint-disable-next-line GL001: only a security definer function writes here
create table public.audit_log (id bigint primary key, action text not null);
