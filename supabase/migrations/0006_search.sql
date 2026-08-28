-- Search: full text, fuzzy, partial, and cited aliases.
--
-- Until now the database had no search capability at all. All fourteen indexes
-- on public.sites were btree/GIN FACET indexes (country, tradition, dynasty,
-- tier, circuits, deities, admin); there was no tsvector, no trigram index, and
-- pg_trgm / unaccent / fuzzystrmatch were available on the instance but not
-- installed. Everything a visitor typed was matched by substring in JavaScript.
--
-- That is the wrong tool for this corpus specifically. Every query here is a
-- PROPER NOUN transliterated from Devanagari, Tamil, Telugu, Kannada, Khmer or
-- Thai, and there is no single correct romanisation: Brihadisvara /
-- Brihadeeswarar / Brihadeeshwara / Bṛhadīśvara are the same temple, and a
-- visitor has no way of knowing which spelling we happened to store. Substring
-- matching answers "nothing found" for three of those four.
--
-- Three mechanisms, because no one of them is sufficient:
--
--   FULL TEXT   ranked, word-aware, weighted by which field matched. Finds
--               "chola thanjavur" across two fields. Cannot survive a typo.
--   TRIGRAM     similarity on a folded name. Survives typos and partial words
--               ("brihad", "bri hadis"). Cannot rank by field importance.
--   ALIASES     a curated, CITED table for variants no algorithm derives —
--               historic names (Kashi for Varanasi), vernacular names, and
--               romanisations that share few trigrams with what we store.
--
-- The 'simple' text search configuration is used deliberately rather than
-- 'english'. English stemming mangles transliterated proper nouns — it would
-- reduce "Amritsar" and "Amrit" to one token and cheerfully stem "Chola" — and
-- almost nothing here is an English word.

-- ---------------------------------------------------------------------------
-- extensions
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- unaccent() is declared STABLE, not IMMUTABLE, because its behaviour depends on
-- a dictionary that could in principle be changed. Postgres therefore refuses it
-- in a generated column or an index expression. This wrapper pins it: the
-- dictionary is not changed on this database, so for our purposes it IS
-- immutable. This is the standard workaround and the reason is worth stating,
-- because a future reader will otherwise assume the wrapper is redundant.
create or replace function public.immutable_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- The one folding rule, used by BOTH the generated columns and every query, so
-- what is indexed and what is searched can never diverge.
create or replace function public.search_fold(text)
returns text
language sql
immutable
strict
parallel safe
set search_path to ''
as $$ select lower(public.immutable_unaccent($1)) $$;

-- ---------------------------------------------------------------------------
-- generated columns
-- ---------------------------------------------------------------------------

-- Folded name, for trigram similarity. Carries the alternate name too: "Peruvudaiyar
-- Kovil" must find Brihadisvara, and it is stored on the same row.
alter table public.sites
  add column if not exists name_fold text
  generated always as (
    public.search_fold(coalesce(name, '') || ' ' || coalesce(alt, '') || ' ' || coalesce(place, ''))
  ) stored;

-- Weighted document. The weights are the ranking policy, stated once:
--   A  name, alt        — what the place is called
--   B  native, place, state — the other two ways people name a temple
--   C  deity, dynasty, style — attribution vocabulary
--   D  significance     — prose; a match here is real but weakest
-- So "Meenakshi" reaches the Meenakshi temple before the dozen records whose
-- history paragraph mentions her, which is the single most common way a naive
-- full-text search embarrasses itself on this corpus.
alter table public.sites
  add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', public.search_fold(coalesce(name, ''))), 'A') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(alt, ''))), 'A') ||
    setweight(to_tsvector('simple', coalesce(native, '')), 'B') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(place, '') || ' ' || coalesce(state, ''))), 'B') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(deity, '') || ' ' || coalesce(dynasty, '') || ' ' || coalesce(style, ''))), 'C') ||
    setweight(to_tsvector('simple', public.search_fold(coalesce(significance, ''))), 'D')
  ) stored;

create index if not exists sites_search_tsv_idx  on public.sites using gin (search_tsv);
create index if not exists sites_name_trgm_idx   on public.sites using gin (name_fold extensions.gin_trgm_ops);

comment on column public.sites.name_fold is
  'Lowercased, unaccented name + alt + place. Trigram-indexed for typo and partial matching. Generated — never write it.';
comment on column public.sites.search_tsv is
  'Weighted search document: A name/alt, B native/place/state, C deity/dynasty/style, D significance. Generated — never write it.';

-- ---------------------------------------------------------------------------
-- cited aliases
-- ---------------------------------------------------------------------------
--
-- The variants no algorithm derives. Trigram similarity will not connect
-- "Kashi" to "Varanasi" or "Ceylon" to "Sri Lanka"; those are facts about
-- history and language, and in this project a fact needs a citation.
--
-- `kind` matters editorially. A `transliteration` is a spelling of the SAME
-- name and asserts nothing new, so it needs no source. A `historic` or
-- `vernacular` alias is a CLAIM about what a place was called, and rule 2
-- applies to it exactly as it applies to any other fact — hence the constraint.
create table if not exists public.site_aliases (
  id          bigint generated always as identity primary key,
  site_id     text not null references public.sites(id) on delete cascade,
  alias       text not null,
  kind        text not null check (kind in ('transliteration', 'historic', 'vernacular', 'abbreviation')),
  source      text,
  created_at  timestamptz not null default now(),
  unique (site_id, alias),
  -- A claim about what a place was called is a sourced fact (CLAUDE.md rule 2).
  -- A respelling of what we already store is not.
  constraint site_aliases_sourced check (
    kind = 'transliteration' or (source is not null and source ~ '^https?://')
  )
);

alter table public.site_aliases
  add column if not exists alias_fold text
  generated always as (public.search_fold(alias)) stored;

create index if not exists site_aliases_fold_trgm_idx on public.site_aliases using gin (alias_fold extensions.gin_trgm_ops);
create index if not exists site_aliases_site_idx      on public.site_aliases (site_id);

alter table public.site_aliases enable row level security;

-- Same posture as public.sites: world-readable, never world-writable. An alias
-- is published content and reaches the table the same way any other fact does.
drop policy if exists site_aliases_public_read on public.site_aliases;
create policy site_aliases_public_read on public.site_aliases
  for select to anon, authenticated using (true);

comment on table public.site_aliases is
  'Cited name variants. transliteration = a respelling of a name we already hold (no source needed). historic/vernacular = a claim about what a place is called, and therefore requires a source (CLAUDE.md rule 2).';

-- ---------------------------------------------------------------------------
-- the search function
-- ---------------------------------------------------------------------------
--
-- Blends the three mechanisms rather than choosing one. An exact word match
-- outranks a fuzzy one; a fuzzy one is returned rather than nothing.
--
-- `match` tells the CALLER which mechanism found the row, so the UI can be
-- honest about a weak result instead of presenting a 0.31-similarity guess with
-- the same confidence as an exact hit. That distinction is the whole reason this
-- returns a label at all.
create or replace function public.search_sites(
  q          text,
  in_limit   integer default 20,
  /** Floor for a fuzzy hit. 0.34 admits "Brihadeeswarar" (0.400) and rejects
      the long tail of unrelated names that share a common Sanskrit root. */
  min_sim    real    default 0.34
)
returns table (
  id         text,
  name       text,
  place      text,
  state      text,
  country    text,
  tradition  text,
  tier       text,
  lat        double precision,
  lng        double precision,
  rank       real,
  match      text
)
language sql
stable
parallel safe
set search_path to 'public', 'extensions'
-- Lowered from the 0.6 default: at 0.6 both "Brihadeeswarar" (0.400) and
-- "minakshi" (0.556) are rejected, which are the exact queries this is for.
set pg_trgm.word_similarity_threshold to 0.34
as $$
  with folded as (select public.search_fold(q) as needle),
  -- websearch_to_tsquery handles quoted phrases and OR without ever throwing on
  -- punctuation, which plainto_tsquery and to_tsquery both do on real input.
  query as (select websearch_to_tsquery('simple', (select needle from folded)) as tsq),
  fts as (
    select s.id, ts_rank(s.search_tsv, (select tsq from query))::real as rank, 'exact'::text as match
    from public.sites s
    where s.search_tsv @@ (select tsq from query)
  ),
  -- word_similarity, NOT similarity, and the difference decides whether this
  -- feature works at all.
  --
  -- `similarity()` compares WHOLE strings. name_fold is name + alt + place, so
  -- for Brihadisvara it is 63 characters — "brihadisvara temple peruvudaiyar
  -- kovil, rajarajesvaram thanjavur". Measured: the query "Brihadeeswarar"
  -- scores 0.123 against it, well under the 0.3 default, so the single most
  -- common spelling of one of the most famous temples in the corpus returned
  -- NOTHING. The longer and better-documented a record is, the harder it became
  -- to find — exactly backwards.
  --
  -- `word_similarity()` scores the query against the best-matching WORD RUN
  -- inside the target instead, so the extra fields stop diluting it. Same pair:
  -- 0.400. Measured across the cases this exists to fix — Brihadeeswarar 0.400,
  -- minakshi 0.556, kedarnth (a typo) 0.667.
  --
  -- The threshold is passed as an argument rather than set as a GUC: the
  -- index-accelerated `<%` operator reads pg_trgm.word_similarity_threshold,
  -- and Supabase refuses `SET pg_trgm.word_similarity_threshold` at function
  -- scope ("permission denied to set parameter"). So this leg is a sequential
  -- scan — measured at 40 ms over 3,031 rows, which is fine now and will not be
  -- at 20,000. Revisit before the corpus grows an order of magnitude; 0007
  -- narrows what has to be scanned rather than removing the scan.
  fuzzy as (
    select s.id, word_similarity((select needle from folded), s.name_fold)::real as rank,
           'fuzzy'::text as match
    from public.sites s
    where word_similarity((select needle from folded), s.name_fold) >= min_sim
  ),
  aliased as (
    select a.site_id as id,
           (0.9 + word_similarity((select needle from folded), a.alias_fold) * 0.1)::real as rank,
           'alias'::text as match
    from public.site_aliases a
    where word_similarity((select needle from folded), a.alias_fold) >= min_sim
  ),
  -- One row per site, keeping its STRONGEST evidence. Without this a temple
  -- matched three ways appears three times, which reads as three temples.
  merged as (
    select id, match, rank,
           row_number() over (
             partition by id
             order by case match when 'exact' then 0 when 'alias' then 1 else 2 end, rank desc
           ) as pick
    from (select * from fts union all select * from aliased union all select * from fuzzy) all_hits
  )
  select s.id, s.name, s.place, s.state, s.country, s.tradition, s.tier, s.lat, s.lng,
         m.rank, m.match
  from merged m
  join public.sites s on s.id = m.id
  where m.pick = 1
  order by case m.match when 'exact' then 0 when 'alias' then 1 else 2 end, m.rank desc, s.name
  limit least(coalesce(in_limit, 20), 100);
$$;

comment on function public.search_sites is
  'Blended search: weighted full text, then cited aliases, then trigram similarity. Returns `match` so a caller can tell an exact hit from a fuzzy guess and say so.';
