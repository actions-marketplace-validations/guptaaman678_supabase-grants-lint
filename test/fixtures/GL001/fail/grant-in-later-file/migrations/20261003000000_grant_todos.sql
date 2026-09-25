-- Too late: the table was unreachable from the previous migration on.
grant select, insert, update, delete on public.todos to service_role;
