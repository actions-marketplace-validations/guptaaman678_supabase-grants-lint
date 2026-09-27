---
'supabase-grants-lint': patch
---

GL002 and GL003 no longer report policies that only admit `service_role`, such as `create policy "Service role only" on t using (auth.role() = 'service_role')`. Such a policy never admits `anon` or `authenticated`, and `service_role` bypasses RLS, so it means "no client access" and needs no client grant. A policy counts as service-role-only when every `USING` and `WITH CHECK` expression is a single comparison of the request role (`auth.role()`, `auth.jwt() ->> 'role'`, the `request.jwt.claim.role` or `request.jwt.claims` settings, `current_user`, `current_role`, `session_user`, optionally wrapped in `(select ...)` or cast to `text`) with `'service_role'`. Anything else, including an `OR`, is still checked.
