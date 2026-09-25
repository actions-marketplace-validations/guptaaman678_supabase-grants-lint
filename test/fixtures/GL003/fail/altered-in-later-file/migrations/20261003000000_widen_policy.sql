-- authenticated has no select privilege on public.todos.
alter policy "guests read todos" on public.todos to anon, authenticated;
