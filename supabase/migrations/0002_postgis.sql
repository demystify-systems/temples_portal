-- PostGIS enablement (L2): nearest, within-radius and bbox queries.
-- Supabase installs extensions into the `extensions` schema, so every PostGIS
-- symbol is referenced schema-qualified — an unqualified call breaks under the
-- empty search_path that security-definer functions run with.

create extension if not exists postgis with schema extensions;

-- Derived, never hand-set: the point always follows lat/lng.
alter table public.sites
  add column if not exists geog geography(Point, 4326)
  generated always as (
    extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::geography
  ) stored;

create index if not exists sites_geog_idx on public.sites using gist (geog);

-- "Temples within N km of here", nearest-first (I3).
create or replace function public.sites_within_km(
  in_lat double precision,
  in_lng double precision,
  in_km  double precision default 50,
  in_limit int default 100
)
returns table (
  id text,
  name text,
  place text,
  state text,
  country text,
  tradition text,
  tier text,
  lat double precision,
  lng double precision,
  distance_km double precision
)
language sql
stable
security invoker
set search_path = extensions, public
as $$
  select s.id, s.name, s.place, s.state, s.country, s.tradition, s.tier, s.lat, s.lng,
         extensions.st_distance(
           s.geog,
           extensions.st_setsrid(extensions.st_makepoint(in_lng, in_lat), 4326)::geography
         ) / 1000.0 as distance_km
  from public.sites s
  where extensions.st_dwithin(
          s.geog,
          extensions.st_setsrid(extensions.st_makepoint(in_lng, in_lat), 4326)::geography,
          in_km * 1000.0
        )
  order by s.geog <-> extensions.st_setsrid(extensions.st_makepoint(in_lng, in_lat), 4326)::geography
  limit least(in_limit, 500);
$$;

-- Viewport queries for the map (bbox in WGS84 degrees).
create or replace function public.sites_in_bbox(
  min_lat double precision,
  min_lng double precision,
  max_lat double precision,
  max_lng double precision,
  in_limit int default 2000
)
returns table (
  id text,
  name text,
  tradition text,
  tier text,
  built_from int,
  lat double precision,
  lng double precision
)
language sql
stable
security invoker
set search_path = extensions, public
as $$
  select s.id, s.name, s.tradition, s.tier, s.built_from, s.lat, s.lng
  from public.sites s
  where s.geog && extensions.st_makeenvelope(min_lng, min_lat, max_lng, max_lat, 4326)::geography
  limit least(in_limit, 5000);
$$;
