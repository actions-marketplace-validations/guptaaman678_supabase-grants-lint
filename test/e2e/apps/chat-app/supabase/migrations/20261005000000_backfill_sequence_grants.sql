-- Fixing the sequence with a blanket grant reaches every sequence in the schema.
grant usage on all sequences in schema public to authenticated;

-- Dynamic SQL cannot be replayed, so it is reported and skipped.
do $$
begin
  execute 'grant select on public.rooms to anon';
end
$$;
