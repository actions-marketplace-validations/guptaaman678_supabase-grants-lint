create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
