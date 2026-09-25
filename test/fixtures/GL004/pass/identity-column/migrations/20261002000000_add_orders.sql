create table public.orders (
  id bigint generated always as identity primary key,
  total_cents integer not null
);
grant select, insert, update, delete on public.orders to service_role;
grant select, insert on public.orders to authenticated;
