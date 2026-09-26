-- A serial key done right: inserting needs USAGE on the owned sequence too.
create table public.rooms (
  id serial primary key,
  name text not null unique,
  created_by uuid not null default auth.uid()
);

alter table public.rooms enable row level security;

create policy "members read rooms" on public.rooms
  for select to authenticated using (true);
create policy "members create rooms" on public.rooms
  for insert to authenticated with check (auth.uid() = created_by);

grant select, insert on public.rooms to authenticated;
grant usage on sequence public.rooms_id_seq to authenticated;
grant select, insert, update, delete on public.rooms to service_role;
