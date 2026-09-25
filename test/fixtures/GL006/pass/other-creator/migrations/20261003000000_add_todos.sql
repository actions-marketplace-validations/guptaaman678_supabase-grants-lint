-- Another role's defaults: the migrations do not create tables as it.
alter default privileges for role supabase_admin in schema public
  grant select on tables to anon;
