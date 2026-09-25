-- A role the Data API never switches to.
alter default privileges in schema public grant select on tables to reporting;
