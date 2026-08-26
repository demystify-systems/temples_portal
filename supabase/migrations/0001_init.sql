-- Tirtha Atlas — initial schema (dormant in v1; apply when activating the DB layer)
-- Design: data/sites.json in the repo is the canonical seed; this table mirrors it
-- for querying, the future contribution queue, and the public read API.

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
  circuits text[] not null default '{}',
  status text[] not null default '{}',
  significance text not null,
  story text not null,
  access text,
  website text,
  phone text,
  wiki text,
  sources jsonb not null,          -- [{l,u}] — no source, no row (enforced below)
  coord_verification text not null default 'curated',
  updated_at timestamptz not null default now(),
  constraint sources_nonempty check (jsonb_array_length(sources) > 0)
);

create index if not exists sites_country_idx on public.sites (country);
create index if not exists sites_tradition_idx on public.sites (tradition);
create index if not exists sites_dynasty_idx on public.sites (dynasty);
create index if not exists sites_built_idx on public.sites (built_from);

-- Contribution queue (v2): open submissions, human-moderated, evidence required.
create table if not exists public.contributions (
  id bigint generated always as identity primary key,
  site_id text references public.sites(id),
  field text not null,
  proposed_value text not null,
  evidence_url text,               -- official link, photo, or call log reference
  contributor_email text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.sites enable row level security;
alter table public.contributions enable row level security;

-- Public read of published sites; writes only via service role (seed script / moderation).
create policy sites_public_read on public.sites for select using (true);
create policy contributions_insert on public.contributions for insert with check (true);
