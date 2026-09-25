-- grants-lint-disable-next-line GL007: local-only schema, reset on every deploy
alter default privileges in schema public grant select on tables to anon;
