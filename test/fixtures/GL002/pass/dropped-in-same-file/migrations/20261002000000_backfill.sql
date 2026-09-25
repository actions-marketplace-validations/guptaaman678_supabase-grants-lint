create table public.orders_backfill (id uuid primary key);
create policy "members read backfill" on public.orders_backfill for select to authenticated using (true);
drop table public.orders_backfill;
