create table public.messages (
  id bigint generated always as identity primary key,
  body text not null
);
alter table public.messages enable row level security;
grant select, insert, update, delete on public.messages to service_role;
-- No TO clause: the policy applies to PUBLIC.
create policy "anyone reads messages" on public.messages for select using (true);
