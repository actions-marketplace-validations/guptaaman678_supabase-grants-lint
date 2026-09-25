create table public.orders (id uuid primary key, total_cents integer not null);
revoke truncate, references, trigger on public.orders from anon, authenticated;
grant select on public.orders to service_role;
create view public.order_totals as select id, total_cents from public.orders;
grant select on public.order_totals to service_role;
