# Discovery strategy — SEO, AEO, GEO, AIO, SXO

How this site gets found, by search engines and by answer engines. Technical surfaces are
being built now (see `src/lib/seo.ts`, `/llms.txt`, JSON-LD). This file covers what to
publish and why.

## The asset nobody else has

Almost every temple site on the internet is one of three things: an unsourced listicle, a
booking funnel, or a single-person corpus that stopped updating in 2011. What this project
has that none of them do is **1,122 records where every fact carries a citation, and where
documented history and legend are held in separate, labelled fields.**

That is not just an editorial virtue — it is the ranking strategy. Answer engines and AI
crawlers are increasingly selecting for provenance. A page that says *"built c. 1010 CE
[source]"* and separately *"tradition holds that… [labelled as katha]"* is exactly the
shape a retrieval system wants to quote. A page that blends the two is exactly what it
learns to distrust.

So: **the citation discipline IS the growth strategy.** Everything below follows from that.

## The five surfaces

| | What it means here |
|---|---|
| **SEO** | Classic: crawlable URLs, titles, canonicals, sitemap, internal links, Core Web Vitals |
| **AEO** | Answer engines: extractive 1–2 sentence answers, FAQ/Breadcrumb JSON-LD, direct question-shaped headings |
| **GEO** | Generative engines: content structured so an LLM can quote it *with the citation attached* |
| **AIO** | AI crawlers: `/llms.txt`, `/llms-full.txt`, explicit bot policy in robots |
| **SXO** | Search experience: the click has to be worth it — fast, readable on a phone, no interstitials |

SXO is the one usually skipped and it is load-bearing. A #1 ranking that bounces because
the header truncates on a phone is worth nothing.

## Content that earns the traffic

Ordered by (search demand × how badly it is currently served).

1. **Per-site pages** — 1,122 already exist. The work is depth, not count: only 26 of 150
   flagship records currently carry what the tier promises.
2. **Circuit pages as answers.** "12 Jyotirlingas", "108 Divya Desams", "51 Shakti Peethas"
   are enormous, permanent queries. Each page should answer the count question in the first
   sentence and list the members in canonical order. *This is blocked on the circuit
   correctness work* — a page claiming to list 12 Jyotirlingas that shows 14 will be
   discounted by exactly the engines we want.
3. **Deity pages** (D5). "Shiva temples in Tamil Nadu", "Murugan temples" — huge head terms
   with no authoritative, cited page anywhere. Blocked on the deity taxonomy.
4. **Sacred-geography essays** (D9). The genuinely original work, and the pages that earn
   links rather than just impressions:
   - How Dravida travelled Kanchi → Thanjavur → Angkor → Java
   - The Shakti Peetha body-map across the subcontinent
   - Why the Jyotirlingas distribute the way they do
   - What the Chola bronzes and their temples say about maritime trade
5. **Epic trails** (D10). Ramayana and Mahabharata sites across India, Nepal and Sri Lanka.
   High demand, almost nothing cited exists.
6. **Patron pages** (H5). Ahilyabai Holkar alone links Kashi, Gaya, Somnath, Grishneshwar
   and Vishnupad — a story no other site tells because no other site has the field.
7. **Practical pilgrim pages** (EPIC F). Timings, dress codes, access, official booking
   links. The highest commercial intent on the site and the highest duty of care: these
   must be sourced or absent, never guessed.

## Framing: civilisational, not irredentist

One item from the brief needs separating out, because it collides with the project's own
guardrail G10 — *"Framing is civilisational, never irredentist."*

**"Akhand Bharat" is a territorial-political claim**, not a religious or cultural one. It
argues that present-day Pakistan, Bangladesh, Afghanistan, Nepal and others should be
reunified into one state. Building a content strategy around that phrase would:

- **Break G10 directly** — the rule was written for exactly this.
- **Destroy N7 and R4.** Press and academic outreach, government MoUs, and institutional
  partnerships all depend on being read as a reference work. One irredentist page reframes
  the whole site as advocacy, permanently and retroactively.
- **Contradict our own data.** Sites in Pakistan and Bangladesh are recorded under those
  countries. Only PoK is listed as India, and that is a Government-of-India position under
  rule 1, not a claim on Bangladesh or Nepal.
- **Lose the actual pilgrims.** Devotees in Nepal, Sri Lanka and Bangladesh are a real part
  of this audience. A site that reads as territorial revanchism gets blocked, reported, and
  avoided in precisely the places whose temples we are documenting.
- **Rank worse.** Political-claim content attracts YMYL-style scrutiny and is a poor fit for
  the answer engines this strategy targets. Cited scholarship is what gets quoted.

**The good news: the civilisational framing reaches further and is already true.** The site
covers 15 countries. The story that Indic sacred architecture, pilgrimage and iconography
form one continuous world from Kashmir to Java is *demonstrable from the data* — it is the
Dravida-to-Angkor essay, the Shakti Peetha map, the Sailendra and Khmer records. That story
earns links from historians, gets cited by answer engines, and offends nobody whose
cooperation we need.

Same reach. Same passion. Vastly better durability. Recommended framing:

> *The sacred geography of the Indic world — Kashmir to Java, 30 centuries, every site cited.*

## Sequencing

Technical surfaces land first because they are cheap and compounding: canonicals (done),
per-site metadata, OG images, JSON-LD, `/llms.txt`, sitemap priorities.

Then correctness, because publishing circuit pages before the counts are right actively
harms ranking. Then depth, then essays.

Do not buy links, spin content, or generate per-city doorway pages. This project's entire
advantage is being trustworthy; the shortcuts trade that for a temporary bump and it is a
terrible trade here.
