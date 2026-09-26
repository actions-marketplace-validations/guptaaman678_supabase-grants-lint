-- Not exposed through the Data API, so it needs no grants and is not checked.
create table private.audit_log (
  id bigserial primary key,
  table_name text not null,
  action text not null,
  logged_at timestamptz not null default now()
);
