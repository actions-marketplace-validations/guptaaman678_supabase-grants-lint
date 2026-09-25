create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
create policy "owners manage todos" on public.todos
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
