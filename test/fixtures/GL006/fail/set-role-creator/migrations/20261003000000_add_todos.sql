set role app_owner;
-- No FOR ROLE: the current role, which creates the tables below.
alter default privileges in schema public grant select on tables to anon;
create table public.messages (id uuid primary key, body text);
reset role;
