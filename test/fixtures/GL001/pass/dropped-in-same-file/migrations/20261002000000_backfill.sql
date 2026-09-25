create table public.orders_backfill (id uuid primary key);
insert into public.orders_backfill select gen_random_uuid();
drop table public.orders_backfill;
