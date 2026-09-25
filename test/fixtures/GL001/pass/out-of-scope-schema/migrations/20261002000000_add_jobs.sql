create schema if not exists private;
create table private.jobs (id bigint primary key, payload jsonb);
