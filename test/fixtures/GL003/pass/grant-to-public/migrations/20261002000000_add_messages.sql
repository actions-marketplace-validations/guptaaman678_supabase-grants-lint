create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);
alter table public.messages enable row level security;
grant select, insert, update, delete on public.messages to service_role;
create policy "guests read messages" on public.messages for select to anon using (true);
grant select on public.messages to public;
