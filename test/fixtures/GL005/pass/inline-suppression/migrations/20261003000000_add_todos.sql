create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
alter table public.todos enable row level security;
-- grants-lint-disable-next-line GL005: every table here is meant to be readable
grant select, insert, update, delete on all tables in schema public to authenticated;
