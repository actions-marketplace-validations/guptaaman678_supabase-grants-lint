create table public.messages (
  id bigserial primary key,
  body text not null
);
grant select on public.messages to anon;
grant select, insert, update, delete on public.messages to service_role;
do $$
begin
  execute 'grant select on public.messages to authenticated';
end
$$;
