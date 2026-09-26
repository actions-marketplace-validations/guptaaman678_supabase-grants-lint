-- A pulled baseline that turns the old automatic grants back on when the history is replayed.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  total numeric not null
);
