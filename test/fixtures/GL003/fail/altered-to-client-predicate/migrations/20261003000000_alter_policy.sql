-- The new USING expression admits clients, so the policy now needs a client grant.
alter policy "read messages" on public.messages using (auth.uid() = user_id);
