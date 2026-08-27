-- Tirtha Atlas — initial schema.
-- Design: data/sites.json in the repo stays canonical; this table mirrors it for
-- querying, the future contribution queue, and the public read API (CLAUDE.md rule 6).
--
-- Nullability below is derived from the actual corpus, not from intent:
--   story — 250 of 941 records legitimately carry no katha. Compact-tier records
--           hold essentials only, so this MUST stay nullable or seeding fails.
--   tier  — absent in the JSON means flagship; the seed maps it explicitly.

create table if not exists public.sites (
  id text primary key,
  name text not null,
  alt text,
  native text,
  country text not null,
  state text,
  place text not null,
  lat double precision not null,
  lng double precision not null,
  tradition text not null check (tradition in ('Hindu','Buddhist','Jain','Sikh')),
  deity text not null,
  built_from int not null,
  built_to int not null,
  built_display text not null,
  origin int,
  origin_note text,
  dynasty text not null,
  patron text,
  style text not null,
  tier text not null default 'compact' check (tier in ('stub','compact','flagship')),
  circuits text[] not null default '{}',
  status text[] not null default '{}',
  significance text not null,
  story text,                      -- nullable: compact tier carries no katha
  access text,
  website text,
  phone text,
  wiki text,
  sources jsonb not null,          -- [{l,u}] — no source, no row
  coord_verification text not null default 'curated',
  updated_at timestamptz not null default now(),

  -- Guardrail G2 enforced at the storage layer, not only in the build gate.
  constraint sources_nonempty check (jsonb_array_length(sources) > 0),
  -- Guardrail G3: documented history and legend must never be the same text.
  constraint story_not_significance check (story is null or story <> significance),
  -- Guardrail G4: a phone number is only publishable alongside its official source.
  constraint phone_needs_website check (phone is null or website is not null),
  constraint built_range_ordered check (built_from <= built_to),
  constraint lat_in_range check (lat between -90 and 90),
  constraint lng_in_range check (lng between -180 and 180)
);

create index if not exists sites_country_idx   on public.sites (country);
create index if not exists sites_state_idx     on public.sites (state);
create index if not exists sites_tradition_idx on public.sites (tradition);
create index if not exists sites_dynasty_idx   on public.sites (dynasty);
create index if not exists sites_built_idx     on public.sites (built_from);
create index if not exists sites_tier_idx      on public.sites (tier);
-- Array containment (`circuits @> '{Jyotirlinga}'`) needs GIN, not btree.
create index if not exists sites_circuits_idx  on public.sites using gin (circuits);
create index if not exists sites_status_idx    on public.sites using gin (status);

-- Keep updated_at honest without relying on every writer to remember it.
create or replace function public.touch_updated_at()
returns trigger language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sites_touch_updated_at on public.sites;
create trigger sites_touch_updated_at
  before update on public.sites
  for each row execute function public.touch_updated_at();

-- Contribution queue (v2): open submissions, human-moderated, evidence required.
-- Guardrail G9 — nothing here ever writes public.sites automatically.
create table if not exists public.contributions (
  id bigint generated always as identity primary key,
  site_id text references public.sites(id) on delete cascade,
  field text not null,
  proposed_value text not null,
  evidence_url text,               -- official link, photo, or call-log reference
  contributor_email text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,

  -- A decision must record when it was taken, and a pending row must not claim one.
  constraint decided_at_matches_status check (
    (status = 'pending' and decided_at is null) or
    (status <> 'pending' and decided_at is not null)
  )
);

create index if not exists contributions_status_idx on public.contributions (status, created_at);
create index if not exists contributions_site_idx   on public.contributions (site_id);

-- RLS is enabled here; the full policy set lands in 0003_rls.sql.
alter table public.sites enable row level security;
alter table public.contributions enable row level security;
