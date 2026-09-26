-- Opted in from the dashboard: no opt-in migration exists, so since is set in config.
-- The platform revoke removes select, insert, update and delete only.
create table public.orders (id uuid primary key, total_cents integer);
