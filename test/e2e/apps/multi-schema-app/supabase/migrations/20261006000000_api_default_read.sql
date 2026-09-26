-- Turns auto-grants back on for every future table in api.
alter default privileges for role postgres in schema api
  grant select on tables to anon;
