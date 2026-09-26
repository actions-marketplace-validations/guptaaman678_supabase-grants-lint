create table public.todos (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  done boolean not null default false
);

alter table public.todos enable row level security;

create policy "read own todos" on public.todos
  for select to authenticated using (user_id = auth.uid());

create policy "add own todos" on public.todos
  for insert to authenticated with check (user_id = auth.uid());

grant insert on public.todos to authenticated;
