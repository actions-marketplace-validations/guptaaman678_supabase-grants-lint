-- public.messages and public.audit_log were created in the dashboard, not in a migration.
alter table public.messages enable row level security;

create policy "read own messages" on public.messages
  for select to authenticated using (auth.uid() = sender_id);

grant select on public.messages to authenticated;
grant insert on public.audit_log to service_role;
