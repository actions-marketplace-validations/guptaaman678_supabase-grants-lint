-- Revokes from the client roles only; service_role keeps its defaults.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
