-- Opt in to explicit Data API grants: new relations get no privileges by default.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
-- Same file as the opt-in, so not a later file: a warning.
alter default privileges in schema public grant select on tables to anon;
