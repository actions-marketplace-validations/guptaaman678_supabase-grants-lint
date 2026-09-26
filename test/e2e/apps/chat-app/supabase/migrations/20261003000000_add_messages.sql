-- The table grant is there, the sequence grant is not: selects work, every insert fails.
create table public.messages (
  id bigserial primary key,
  room_id integer not null references public.rooms (id) on delete cascade,
  sender_id uuid not null default auth.uid(),
  body text not null,
  sent_at timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "members read messages" on public.messages
  for select to authenticated using (true);
create policy "members send messages" on public.messages
  for insert to authenticated with check (auth.uid() = sender_id);

grant select, insert on public.messages to authenticated;
grant select, insert, update, delete on public.messages to service_role;
