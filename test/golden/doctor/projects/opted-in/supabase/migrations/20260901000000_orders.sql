create table public.orders (
  id uuid primary key,
  total numeric
);
alter table public.orders enable row level security;
create policy "users read orders" on public.orders
  for select to authenticated using (true);
