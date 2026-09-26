-- A later file does not fix the earlier one: the earlier migration still ships without grants,
-- and anything deployed between the two fails.
grant select, insert, delete on public.todo_tags to authenticated;
grant select, insert, update, delete on public.todo_tags to service_role;
