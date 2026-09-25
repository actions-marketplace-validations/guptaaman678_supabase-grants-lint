-- No IN SCHEMA: a per-schema revoke cannot remove it.
alter default privileges for role postgres grant all on tables to anon, authenticated;
