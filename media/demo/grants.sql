
grant select, insert, update, delete on public.todos to service_role;
grant usage on sequence public.todos_id_seq to authenticated;
grant select on public.todos to authenticated;
