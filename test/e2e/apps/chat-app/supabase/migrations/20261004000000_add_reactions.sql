-- Identity keys have no separately granted sequence to forget.
create table public.reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  emoji text not null
);

alter table public.reactions enable row level security;

create policy "members read reactions" on public.reactions
  for select to authenticated using (true);
create policy "members manage own reactions" on public.reactions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, delete on public.reactions to authenticated;
grant select, insert, update, delete on public.reactions to service_role;
