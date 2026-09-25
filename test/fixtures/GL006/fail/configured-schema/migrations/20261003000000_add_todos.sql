create schema if not exists api;
alter default privileges in schema api grant select on tables to authenticated;
