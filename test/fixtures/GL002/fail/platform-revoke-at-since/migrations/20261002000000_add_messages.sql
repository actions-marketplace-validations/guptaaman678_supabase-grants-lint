-- Opted in from the dashboard: no opt-in migration exists, so since is set in config.
create table public.messages (id bigint primary key, body text not null);
alter table public.messages enable row level security;
create policy "members read messages" on public.messages for select to authenticated using (true);
