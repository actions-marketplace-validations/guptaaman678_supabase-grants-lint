-- Reads work, but the insert policy is dead: authenticated holds no INSERT.
create table public.todo_notes (
  id uuid primary key default gen_random_uuid(),
  todo_id uuid not null references public.todos (id) on delete cascade,
  author_id uuid not null default auth.uid(),
  body text not null
);

alter table public.todo_notes enable row level security;

create policy "read notes" on public.todo_notes
  for select to authenticated
  using (true);

create policy "write own notes" on public.todo_notes
  for insert to authenticated
  with check (auth.uid() = author_id);

grant select on public.todo_notes to authenticated;
grant select, insert, update, delete on public.todo_notes to service_role;
