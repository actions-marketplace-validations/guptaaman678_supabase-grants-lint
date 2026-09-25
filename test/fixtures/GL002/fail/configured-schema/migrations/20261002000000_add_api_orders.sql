create schema if not exists api;
create table api.orders (id uuid primary key, total_cents integer);
grant select, insert, update, delete on api.orders to service_role;
create policy "members read orders" on api.orders for select to authenticated using (true);
