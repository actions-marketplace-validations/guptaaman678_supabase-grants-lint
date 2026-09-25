-- Too late for the migration that created the table.
revoke truncate, references, trigger on public.todos from anon, authenticated;
