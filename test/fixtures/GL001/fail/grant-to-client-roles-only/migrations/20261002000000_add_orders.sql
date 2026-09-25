create table public.orders (
  id uuid primary key default gen_random_uuid(),
  total_cents integer not null
);
grant select, insert on public.orders to anon, authenticated;
