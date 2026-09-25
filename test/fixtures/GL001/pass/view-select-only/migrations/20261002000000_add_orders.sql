create table public.orders (id uuid primary key, total_cents integer);
grant select, insert, update, delete on public.orders to service_role;
create view public.order_summary as select count(*) as order_count from public.orders;
grant select on public.order_summary to service_role;
