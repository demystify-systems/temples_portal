-- Row Level Security (L5).
--
-- Posture, in one line: the corpus is world-readable, nobody but the service role
-- can write it, and the public may only ever append to the moderation queue.
-- The service role bypasses RLS entirely, so the seed script and any moderation
-- tooling keep working without a write policy existing at all.
--
-- Guardrail G9 (automation detects, humans decide) is structural here: there is
-- no path from `contributions` into `sites` that does not pass through a human
-- holding the service role.

-- ---------------------------------------------------------------- sites
drop policy if exists sites_public_read on public.sites;
create policy sites_public_read
  on public.sites
  for select
  to anon, authenticated
  using (true);

-- Deliberately no insert/update/delete policy for anon or authenticated.
-- With RLS enabled and no permissive policy, those writes are denied.

-- -------------------------------------------------------- contributions
drop policy if exists contributions_insert on public.contributions;
drop policy if exists contributions_public_insert on public.contributions;
drop policy if exists contributions_read_own on public.contributions;

-- Anyone may propose a correction, but only ever as a pending row: a submitter
-- cannot pre-approve their own edit by posting status='approved'.
create policy contributions_public_insert
  on public.contributions
  for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and decided_at is null
    and reviewer_note is null
    and length(proposed_value) between 1 and 4000
    and (evidence_url is null or evidence_url ~ '^https://')
  );

-- A signed-in contributor may read back only their own submissions. Anonymous
-- submitters get no read at all — otherwise the queue leaks contributor emails.
create policy contributions_read_own
  on public.contributions
  for select
  to authenticated
  using (contributor_email = (select auth.jwt() ->> 'email'));

-- No update or delete policy: a submission is immutable once filed, and only the
-- service role (a human moderator) can decide it.

-- ------------------------------------------------------- least privilege
-- PostgREST reaches the database as anon/authenticated; grant only what the
-- policies above are meant to allow, so a future permissive policy cannot
-- accidentally widen access beyond these verbs.
revoke all on public.sites from anon, authenticated;
grant select on public.sites to anon, authenticated;

revoke all on public.contributions from anon, authenticated;
grant insert on public.contributions to anon, authenticated;
grant select on public.contributions to authenticated;
