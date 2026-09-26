alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon, authenticated, service_role;
