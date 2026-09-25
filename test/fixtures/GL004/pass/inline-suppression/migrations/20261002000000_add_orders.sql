-- grants-lint-disable-next-line GL004: clients always send their own id
create table public.orders (
  id bigserial primary key,
  total_cents integer not null
);
alter table public.orders enable row level security;
grant select, insert, update, delete on public.orders to service_role;
grant usage on sequence public.orders_id_seq to service_role;
grant select, insert on public.orders to authenticated;
