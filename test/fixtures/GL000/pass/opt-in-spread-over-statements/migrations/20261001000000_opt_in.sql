alter default privileges for role postgres in schema public
  revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke all on tables from authenticated;
alter default privileges for role postgres
  revoke all on tables from service_role;
