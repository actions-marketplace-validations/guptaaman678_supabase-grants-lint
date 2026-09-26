-- Opt in to explicit Data API grants: new relations get no privileges by default.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
create policy "owners read todos" on public.todos
  for select to authenticated using (auth.uid() = user_id);
grant select on public.todos to authenticated;
grant select, insert, update, delete on public.todos to service_role;
