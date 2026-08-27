-- Contested circuit membership (guardrail G10).
--
-- Held alongside `circuits`, never inside it: a record both CLAIMS the circuit
-- and FLAGS the claim. Rival claimants contest a slot, so both sides carry an
-- entry — Baidyanath Deoghar and Vaijnath Parli dispute one Jyotirlinga between
-- them, which is why 10 uncontested + 2 contested slots is a complete 12.
--
-- Keeping `circuits` a plain text[] preserves array containment queries, the GIN
-- index, slug routing and the facet filter. jsonb here because each entry needs
-- a status, a dated neutral note and its own citation.
alter table public.sites
  add column if not exists disputed_circuits jsonb not null default '[]'::jsonb;

-- A CHECK constraint cannot contain a subquery, so the per-element validation
-- lives in an IMMUTABLE function. A disputed claim is itself an assertion and
-- needs a note; `disputed` status additionally needs the source documenting the
-- dispute (guardrail G2).
create or replace function public.disputed_circuits_valid(v jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(v) = 'array'
     and not exists (
       select 1
       from jsonb_array_elements(v) e
       where coalesce(e->>'circuit', '') = ''
          or coalesce(e->>'note', '') = ''
          or coalesce(e->>'status', '') not in ('disputed', 'unsourced')
          or ((e->>'status') = 'disputed' and coalesce(e->>'source', '') !~ '^https?://')
     );
$$;

alter table public.sites drop constraint if exists disputed_circuits_shape;
alter table public.sites add constraint disputed_circuits_shape
  check (public.disputed_circuits_valid(disputed_circuits));

create index if not exists sites_disputed_circuits_idx
  on public.sites using gin (disputed_circuits);
