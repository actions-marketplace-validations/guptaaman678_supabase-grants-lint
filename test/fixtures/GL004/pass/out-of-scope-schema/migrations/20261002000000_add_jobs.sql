create schema if not exists private;
create table private.jobs (id bigserial primary key, payload jsonb);
grant insert on private.jobs to authenticated;
