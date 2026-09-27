alter default privileges in schema public
  grant truncate, references, trigger on tables to anon, authenticated;
alter default privileges in schema public grant update on sequences to anon;
