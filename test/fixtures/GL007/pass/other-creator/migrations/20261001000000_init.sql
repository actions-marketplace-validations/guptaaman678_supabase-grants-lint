-- Another role's defaults: the migrations do not create tables as it.
alter default privileges for role supabase_admin in schema public
  grant all on tables to anon, authenticated, service_role;
