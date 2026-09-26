create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null
);
alter table public.todos enable row level security;
create policy "owners manage todos" on public.todos
  for all to authenticated using (auth.uid() = user_id);
