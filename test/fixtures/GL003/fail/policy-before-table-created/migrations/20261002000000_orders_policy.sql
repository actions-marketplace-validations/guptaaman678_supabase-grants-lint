-- This file sorts before the one that creates public.orders, so a replay fails here.
create policy "members read orders" on public.orders for select to authenticated using (true);
