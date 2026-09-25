-- A pulled baseline that restores the legacy auto-grants.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
