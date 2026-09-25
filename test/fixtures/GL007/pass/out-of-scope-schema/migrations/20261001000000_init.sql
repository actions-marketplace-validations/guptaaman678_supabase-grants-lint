create schema if not exists private;
alter default privileges in schema private grant all on tables to service_role;
