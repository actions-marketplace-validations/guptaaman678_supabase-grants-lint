create table public.orders (
  id bigserial primary key,
  total numeric not null
);

grant all on all tables in schema public to service_role;
grant select, insert on public.orders to authenticated;
grant usage on sequence public.orders_id_seq to authenticated;

create policy "members insert orders" on public.orders
  as restrictive for insert to authenticated
  with check (true);
