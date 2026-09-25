-- A column named serial is not a serial column.
create table public.todos (id uuid primary key, serial text not null);
grant insert on public.todos to authenticated;
