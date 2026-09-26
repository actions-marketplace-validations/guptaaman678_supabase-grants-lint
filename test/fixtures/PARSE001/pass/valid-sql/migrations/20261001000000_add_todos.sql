create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
grant select, insert, update, delete on public.todos to authenticated;
create function public.todo_count() returns bigint
language sql stable as $$ select count(*) from public.todos $$;
comment on table public.todos is 'grant select, create tabel: prose, not SQL';
