create schema if not exists private;
create table private.jobs (id bigint primary key, payload jsonb);
create policy "members read jobs" on private.jobs for select to authenticated using (true);
