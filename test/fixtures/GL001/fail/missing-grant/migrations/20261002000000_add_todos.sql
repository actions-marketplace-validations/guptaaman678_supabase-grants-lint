create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null,
  done boolean not null default false
);
alter table public.todos enable row level security;
create policy "owners read todos" on public.todos
  for select to authenticated using (auth.uid() = user_id);
grant select on public.todos to authenticated;
