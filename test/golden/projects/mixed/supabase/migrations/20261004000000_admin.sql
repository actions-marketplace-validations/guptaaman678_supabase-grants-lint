do $$
begin
  execute 'grant select on public.orders to anon';
end
$$;
create tabel public.audit_log (id bigint primary key);
