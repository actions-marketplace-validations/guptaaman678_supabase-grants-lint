-- Granted, then revoked again in the same file: not in effect at the end.
alter default privileges in schema public grant select on tables to anon;
alter default privileges in schema public revoke select on tables from anon;
