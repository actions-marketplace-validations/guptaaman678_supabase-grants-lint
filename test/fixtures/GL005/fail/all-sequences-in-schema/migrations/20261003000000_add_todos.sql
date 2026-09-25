create table public.orders (id bigserial primary key);
grant insert on public.orders to authenticated;
grant usage on all sequences in schema public to authenticated;
