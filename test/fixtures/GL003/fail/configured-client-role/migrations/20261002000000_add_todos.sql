create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
grant insert on public.todos to support_staff;
create policy "support staff read todos" on public.todos
  for select to support_staff using (true);
