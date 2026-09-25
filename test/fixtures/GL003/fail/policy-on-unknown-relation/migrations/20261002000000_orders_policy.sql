-- public.orders was created in the dashboard, not in a migration.
create policy "members read orders" on public.orders for select to authenticated using (true);
