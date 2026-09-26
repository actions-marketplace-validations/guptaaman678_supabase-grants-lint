-- Saved with Windows line endings (CRLF): lines, columns, comments and suppressions must
-- come out exactly as for the same file with LF endings.
/* A block comment
   over two lines. */
create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);
grant select, insert, update, delete on public.messages to service_role;
alter table public.messages enable row level security;
create policy "members read messages" on public.messages
  for select to authenticated using (true);
-- grants-lint-disable-next-line GL001: written only by a security definer function
create table public.audit_log (id bigint primary key);
grant select on public.audit_log to anon; create table public.orders (id bigint primary key);
do $$
begin
  execute 'grant select on public.orders to service_role';
end
$$;
/* grants-lint-disable-next-line GL001: filled by a nightly job,
   never read through the Data API */
create table public.todos (id bigint primary key)
;
create table public.invoices (
  id bigint primary key
)
;
