-- Server code reads this view as service_role, which was never granted it.
create view api.order_totals
with (security_invoker = true) as
  select customer_id, count(*) as orders, sum(total_cents) as total_cents
  from api.orders
  group by customer_id;

grant select on api.order_totals to authenticated;
