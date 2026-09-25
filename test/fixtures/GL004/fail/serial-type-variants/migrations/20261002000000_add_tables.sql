create table public.messages (id smallserial primary key, body text);
create table public.audit_log (id serial8 primary key, action text);
grant insert on public.messages, public.audit_log to authenticated;
