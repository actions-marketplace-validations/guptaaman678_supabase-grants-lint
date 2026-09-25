create table public.orders (
  id uuid primary key default gen_random_uuid(),
  total_cents integer not null
);
grant select, insert, update, delete on public.orders to service_role;
grant select, insert on public.orders to authenticated;
