create schema if not exists private;
alter default privileges in schema private grant select on tables to service_role;
