do $$
begin
  if not exists (select 1 from pg_tables where tablename = 'orders') then
    create table public.orders (id uuid primary key);
  end if;
end
$$;
