create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  body text not null
);
alter table public.messages enable row level security;
create policy "edit own messages" on public.messages for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
