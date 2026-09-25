create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null,
  done boolean not null default false
);
alter table public.todos enable row level security;
-- grant select, insert, update, delete on public.todos to service_role;
/* grant all on public.todos to service_role; */
comment on table public.todos is 'grant select on public.todos to service_role';
