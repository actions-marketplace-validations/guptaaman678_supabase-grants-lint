create schema if not exists api;
create schema if not exists private;

-- Opt in to explicit Data API grants in both exposed schemas.
alter default privileges for role postgres in schema public, api
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public, api
  revoke all on sequences from anon, authenticated, service_role;

grant usage on schema api to anon, authenticated, service_role;
