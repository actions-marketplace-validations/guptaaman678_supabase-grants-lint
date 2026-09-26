create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.todos enable row level security;
grant select, insert, update, delete on public.todos to service_role;
grant select, insert, update, delete on public.todos to authenticated;
do $$
begin
  execute 'grant select on public.todos to anon';
end
$$;
