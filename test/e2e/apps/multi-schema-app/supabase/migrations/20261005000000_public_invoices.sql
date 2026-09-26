create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references api.orders (id),
  number text not null unique
);

alter table public.invoices enable row level security;

create policy "anyone can look up an invoice number" on public.invoices
  for select to anon using (true);

-- "grant all" also hands the client roles TRUNCATE, REFERENCES and TRIGGER.
grant all on public.invoices to anon, authenticated, service_role;
