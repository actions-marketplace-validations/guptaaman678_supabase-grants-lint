create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
create policy "owners read todos" on public.todos
  for select to authenticated using (auth.uid() = user_id);
grant select (id, title) on public.todos to authenticated;
