create table public.orders (
  id uuid primary key default gen_random_uuid(),
  total numeric not null
);
alter table public.orders enable row level security;
create policy "anyone reads orders" on public.orders
  for select to anon using (true);
grant select, insert, update, delete on public.orders to service_role;
grant all on public.orders to authenticated;
-- grants-lint-disable-next-line GL001: kept to show an unused suppression
grant select on public.orders to service_role;
grant select on all sequences in schema public to authenticated;
