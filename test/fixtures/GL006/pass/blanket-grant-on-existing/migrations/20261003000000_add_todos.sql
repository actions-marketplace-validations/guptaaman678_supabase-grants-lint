create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to authenticated, service_role;
-- GL005's business: existing relations, not default privileges.
grant select on all tables in schema public to anon;
