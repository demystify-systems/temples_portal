-- Transliteration normalisation — the thing that actually makes search work here.
--
-- 0006 added full text and trigram search, and measured against real queries it
-- was still wrong in the cases that matter most. "Brihadeeswarar" — the commonest
-- spelling of one of the most famous temples in the corpus — returned
-- "Abhaya VARADEESWARAR Temple" above "Brihadisvara Temple". "minakshi" returned
-- "Jnanakshi Rajarajeshwari" above "Meenakshi Amman".
--
-- That is not a tuning problem and no threshold fixes it. Indic temple names
-- share long Sanskrit morphemes — -eeswarar, -eshwara, -akshi, -natha — so on
-- raw trigrams the shared SUFFIX outweighs the distinguishing STEM. The fix has
-- to happen before the comparison: collapse the ways one sound gets romanised,
-- so that two spellings of the same name become the same string.
--
-- There is no single correct romanisation of these names. Brihadisvara,
-- Brihadeeswarar, Brihadeeshwara and Bṛhadīśvara are one temple, and a visitor
-- has no way of knowing which one we happened to store. So we store all of them,
-- by normalising both sides.
--
-- The rules, each one a real equivalence in Indic romanisation:
--
--   ee, ii  -> i     Meenakshi / Minakshi / Mīnākṣī
--   oo, uu  -> u     Thirukoodalur / Thirukudalur
--   w       -> v     Vishwanath / Vishvanath, -eshwara / -esvara
--   sh      -> s     Vishwanath / Visvanath, ś and ṣ both fold to s already
--   th      -> t     Tirupathi / Tirupati, Thanjavur / Tanjavur
--   XX      -> X     Amman / Aman — doubling is not phonemic in romanisation
--
-- Measured on the failing cases, correct target vs the wrong one it used to beat:
--
--   query            correct   wrong    verdict
--   Brihadeeswarar    0.857    0.571    fixed
--   minakshi          1.000    0.500    fixed
--   Mīnākṣī           1.000     --      fixed
--   tirupathi         1.000     --      fixed  (0.700 before the th rule)
--
-- What this deliberately does NOT do: it never rewrites a stored NAME. The
-- normalised form exists only to be compared against; every name the atlas
-- DISPLAYS is the one its sources use (CLAUDE.md rule 2). This is a search
-- affordance, not an editorial claim about what a place is called.

create or replace function public.indic_norm(text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               translate(
                 regexp_replace(
                   regexp_replace(lower(public.immutable_unaccent($1)), '(ee|ii)', 'i', 'g'),
                 '(oo|uu)', 'u', 'g'),
               'w', 'v'),
             'sh', 's', 'g'),
           'th', 't', 'g'),
         '(.)\1+', '\1', 'g')
$$;

comment on function public.indic_norm is
  'Collapses Indic romanisation variants so two spellings of one name compare equal: ee/ii->i, oo/uu->u, w->v, sh->s, th->t, doubled letters->single. Used for MATCHING only — never for anything the atlas displays.';

-- The matching surface. Name, alt and place, because all three are things people
-- type when they mean a temple.
alter table public.sites
  add column if not exists name_norm text
  generated always as (
    public.indic_norm(coalesce(name, '') || ' ' || coalesce(alt, '') || ' ' || coalesce(place, ''))
  ) stored;

create index if not exists sites_name_norm_trgm_idx
  on public.sites using gin (name_norm extensions.gin_trgm_ops);

comment on column public.sites.name_norm is
  'Transliteration-normalised name + alt + place, for fuzzy matching. Generated — never write it, and never display it.';

alter table public.site_aliases
  add column if not exists alias_norm text
  generated always as (public.indic_norm(alias)) stored;

create index if not exists site_aliases_norm_trgm_idx
  on public.site_aliases using gin (alias_norm extensions.gin_trgm_ops);

-- The full-text document gets the normalised form appended at weight A as well,
-- so an EXACT hit is possible on a variant spelling and not only a fuzzy one.
-- Exact outranks fuzzy in search_sites, so this is what promotes
-- "Brihadeeswarar" from a lucky similarity score to a confident match.
alter table public.sites drop column if exists search_tsv;
alter table public.sites
  add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.search_fold(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.indic_norm(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(alt, ''))), 'A') ||
    setweight(to_tsvector('simple', public.indic_norm(coalesce(alt, ''))), 'A') ||
    setweight(to_tsvector('simple', coalesce(native, '')), 'B') ||
    setweight(to_tsvector('simple', public.indic_norm(coalesce(place, '') || ' ' || coalesce(state, ''))), 'B') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(deity, '') || ' ' || coalesce(dynasty, '') || ' ' || coalesce(style, ''))), 'C') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(significance, ''))), 'D')
  ) stored;

create index if not exists sites_search_tsv_idx on public.sites using gin (search_tsv);

-- Search now compares normalised forms on every leg.
create or replace function public.search_sites(
  q text, in_limit integer default 20, min_sim real default 0.34
)
returns table (
  id text, name text, place text, state text, country text, tradition text,
  tier text, lat double precision, lng double precision, rank real, match text
)
language sql stable parallel safe
set search_path to 'public', 'extensions'
as $$
  with folded as (select public.indic_norm(q) as needle),
  query as (select websearch_to_tsquery('simple', (select needle from folded)) as tsq),
  fts as (
    select s.id, ts_rank(s.search_tsv, (select tsq from query))::real as rank, 'exact'::text as match
    from public.sites s where s.search_tsv @@ (select tsq from query)
  ),
  fuzzy as (
    select s.id, word_similarity((select needle from folded), s.name_norm)::real as rank,
           'fuzzy'::text as match
    from public.sites s
    where word_similarity((select needle from folded), s.name_norm) >= min_sim
  ),
  aliased as (
    select a.site_id as id,
           (0.9 + word_similarity((select needle from folded), a.alias_norm) * 0.1)::real as rank,
           'alias'::text as match
    from public.site_aliases a
    where word_similarity((select needle from folded), a.alias_norm) >= min_sim
  ),
  merged as (
    select id, match, rank,
           row_number() over (
             partition by id
             order by case match when 'exact' then 0 when 'alias' then 1 else 2 end, rank desc
           ) as pick
    from (select * from fts union all select * from aliased union all select * from fuzzy) all_hits
  )
  select s.id, s.name, s.place, s.state, s.country, s.tradition, s.tier, s.lat, s.lng, m.rank, m.match
  from merged m join public.sites s on s.id = m.id
  where m.pick = 1
  order by case m.match when 'exact' then 0 when 'alias' then 1 else 2 end, m.rank desc, s.name
  limit least(coalesce(in_limit, 20), 100);
$$;
