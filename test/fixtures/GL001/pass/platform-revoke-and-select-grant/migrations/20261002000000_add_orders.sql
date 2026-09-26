-- Opted in from the dashboard: no opt-in migration exists, so since is set in config.
create table public.orders (id uuid primary key, total_cents integer);
grant select on public.orders to service_role;
