-- Columns for fields the corpus gained after 0001: the derived deity tags, the
-- administrative hierarchy, disputed circuit claims, and how a phone was obtained.
--
-- All additive and all nullable. Nothing here rewrites or constrains an existing
-- row, so it is safe to apply to a live database ahead of the seed.
--
-- `deities` and `deity_group` are DERIVED from the free-text `deity` by
-- scripts/build-deity-tags.mjs against data/vocab/deity.json. The repo JSON stays
-- canonical (CLAUDE.md rule 6) — this table mirrors it, so these are never edited
-- here; they are regenerated and re-seeded.

alter table public.sites
  add column if not exists deities           text[]  not null default '{}',
  add column if not exists deity_group       text,
  add column if not exists admin             text[]  not null default '{}',
  add column if not exists disputed_circuits jsonb   not null default '[]'::jsonb,
  add column if not exists phone_verified    text;

comment on column public.sites.deities is
  'Canonical deity tags derived from `deity` via data/vocab/deity.json. Empty when the dedication names no recognisable figure — a relic stupa or a monastic complex — which is a correct outcome, not a gap.';
comment on column public.sites.deity_group is
  'Tradition stream: Shaiva, Vaishnava, Shakta, Smarta, Jain, Buddhist or Sikh.';
comment on column public.sites.admin is
  'Administrative hierarchy from Wikidata P131 (CC0), locality first: ["Kathmandu","Kathmandu District","Bagmati Province"].';
comment on column public.sites.disputed_circuits is
  'Circuit memberships that are contested or unsourced, each with a dated neutral note and its source. The circuit itself stays in `circuits`; nothing is deleted to make a count fit.';
comment on column public.sites.phone_verified is
  'How the phone was obtained. Only ever from the temple''s own official website or a dated call log (CLAUDE.md rule 4).';

-- Deity and region are both faceted in the UI, so index them for the filters
-- rather than making every query scan.
create index if not exists sites_deities_idx     on public.sites using gin (deities);
create index if not exists sites_admin_idx       on public.sites using gin (admin);
create index if not exists sites_deity_group_idx on public.sites (deity_group);
