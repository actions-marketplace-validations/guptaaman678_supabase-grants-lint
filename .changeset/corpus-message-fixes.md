---
'supabase-grants-lint': patch
---

Clearer messages for two findings seen on real projects. GL003's warning for a policy on a relation the replay has not seen now names the later migration that creates it, when there is one: that file sorts after the policy, so replaying the migrations (`supabase db reset`, a preview branch) fails at the policy. GL008 now says the leftover privileges come from the default privileges or a `grant all`, since an explicit `grant all` leaves them too.
