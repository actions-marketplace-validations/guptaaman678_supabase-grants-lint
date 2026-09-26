create table public.orders (id uuid primary key, total numeric not null);
alter table public.orders enable row level security;
grant select on public.orders to authenticated;
