create table public.todos (
  id bigint generated always as identity primary key,
  owner uuid not null,
  title text not null
);

alter table public.todos enable row level security;

create policy "owners read todos" on public.todos
  for select to authenticated
  using (owner = auth.uid());
