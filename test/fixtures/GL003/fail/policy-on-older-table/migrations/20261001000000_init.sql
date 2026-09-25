-- Created with the legacy auto-grants.
create table public.orders (id uuid primary key, total_cents integer);
alter table public.orders enable row level security;
