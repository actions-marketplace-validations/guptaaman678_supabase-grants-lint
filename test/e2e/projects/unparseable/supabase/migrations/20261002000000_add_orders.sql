create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null
);
grant select, insert, update, delete on public.todos to service_role;
create tabel public.orders (id uuid primary key);
