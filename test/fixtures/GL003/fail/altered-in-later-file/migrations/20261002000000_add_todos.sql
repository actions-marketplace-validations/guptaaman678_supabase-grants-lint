create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
grant select on public.todos to anon;
create policy "guests read todos" on public.todos for select to anon using (true);
