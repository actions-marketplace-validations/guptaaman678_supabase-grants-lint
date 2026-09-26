alter table public.todos rename to tasks;

revoke all on public.tasks from anon;
grant select (title) on public.tasks to anon;
revoke insert, delete on public.tasks from authenticated;

alter policy "owners read todos" on public.tasks rename to "owners read tasks";
