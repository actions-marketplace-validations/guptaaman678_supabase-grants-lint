-- Before the opt-in: new tables still get the platform's default grants.
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  title text not null,
  done boolean not null default false,
  inserted_at timestamptz not null default now()
);

alter table public.todos enable row level security;

create policy "owners manage todos" on public.todos
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
