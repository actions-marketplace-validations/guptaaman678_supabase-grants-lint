-- Done right: grants for the client role and for server code, in the same file.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null
);

alter table public.tags enable row level security;

create policy "owners manage tags" on public.tags
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.tags to authenticated;
grant select, insert, update, delete on public.tags to service_role;
