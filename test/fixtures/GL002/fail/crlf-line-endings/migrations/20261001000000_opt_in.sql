-- Saved with Windows line endings (CRLF), as editors on Windows do.
-- Opt in to explicit Data API grants: new relations get no privileges by default.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
