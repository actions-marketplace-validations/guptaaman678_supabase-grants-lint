-- Forgot the grants: RLS looks right, but every request fails with 42501.
create table public.todo_tags (
  todo_id uuid not null references public.todos (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  primary key (todo_id, tag_id)
);

alter table public.todo_tags enable row level security;

create policy "owners manage todo tags" on public.todo_tags
  for all to authenticated
  using (exists (select 1 from public.todos t where t.id = todo_id and t.user_id = auth.uid()));
