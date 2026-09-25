create schema if not exists api;
create schema if not exists private;
create table api.orders (id uuid primary key, total_cents integer);
create table private.jobs (id bigint primary key, payload jsonb);
