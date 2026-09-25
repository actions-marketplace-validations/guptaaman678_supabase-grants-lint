create table public.orders (id bigserial primary key);
alter default privileges in schema public grant usage on sequences to authenticated;
