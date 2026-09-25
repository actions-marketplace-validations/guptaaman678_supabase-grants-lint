create schema if not exists private;
create table private.jobs (id uuid primary key, payload jsonb);
