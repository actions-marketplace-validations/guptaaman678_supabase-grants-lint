create schema if not exists api;
create table api.messages (id uuid primary key, body text);
grant select on all tables in schema api to authenticated;
