create table public.todos (
  id bigserial primary key,
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
create policy "owners manage todos" on public.todos
  for all to authenticated using (auth.uid() = user_id);
grant select, insert on public.todos to authenticated;
