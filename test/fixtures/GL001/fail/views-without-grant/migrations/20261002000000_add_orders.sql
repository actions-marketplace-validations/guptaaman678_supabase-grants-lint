create table public.orders (
  id uuid primary key default gen_random_uuid(),
  total_cents integer not null
);
grant select, insert, update, delete on public.orders to service_role;

create view public.order_summary as
  select count(*) as order_count from public.orders;

create materialized view public.order_totals as
  select sum(total_cents) as total_cents from public.orders;
