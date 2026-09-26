create table api.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null default auth.uid(),
  total_cents integer not null check (total_cents >= 0),
  placed_at timestamptz not null default now()
);

alter table api.orders enable row level security;

create policy "customers read own orders" on api.orders
  for select to authenticated using (auth.uid() = customer_id);
create policy "customers place orders" on api.orders
  for insert to authenticated with check (auth.uid() = customer_id);

grant select, insert on api.orders to authenticated;
grant select, insert, update, delete on api.orders to service_role;
