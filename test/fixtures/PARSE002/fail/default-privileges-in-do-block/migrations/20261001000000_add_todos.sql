do $$
begin
  execute 'alter default privileges in schema public revoke all on tables from anon';
end
$$;
