create schema if not exists private;
create table private.jobs (id uuid primary key, payload jsonb);
grant select on all tables in schema private to service_role;
