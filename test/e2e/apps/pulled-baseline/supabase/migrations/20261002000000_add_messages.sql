-- Written after the baseline, relying on auto-grants that production no longer gives.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid(),
  body text not null
);

alter table public.messages enable row level security;

create policy "members read messages" on public.messages
  for select to authenticated using (true);
