create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);
alter table public.messages enable row level security;
grant select, insert, update, delete on public.messages to service_role;
create policy "everyone reads messages" on public.messages
  for select to anon, authenticated using (true);
grant select on public.messages to authenticated;
