alter default privileges for role postgres in schema public
  grant all on tables to service_role;
create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  title text not null,
  done boolean not null default false
);
alter table public.todos enable row level security;
