create table public.orders (id uuid primary key, total_cents integer);
revoke truncate, references, trigger, maintain on public.orders from service_role;
