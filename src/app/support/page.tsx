import type { Metadata } from "next";
import Link from "next/link";
import { SITES } from "@/lib/sites";
import { FLAGS } from "@/lib/flags";
import { PageShell } from "../ui";

/**
 * /support — what this project costs and why it might one day ask for help.
 *
 * Scaffolded behind `NEXT_PUBLIC_SUPPORT_PAGE`, which is OFF by default. The
 * commercial posture of this project is undecided and no payment provider has
 * been chosen, so this page contains **no donate button, no provider SDK, and no
 * payment code**, in either state of the flag. Adding any of those is a decision
 * for a human, taken deliberately, not a follow-up chore.
 *
 * Why it renders rather than `notFound()` when the flag is off: a 404 hides the
 * copy from the people who have to agree with it before it is published, and
 * makes the route's behaviour change shape when the flag flips. Rendering with a
 * plain statement of the truth — this project is not accepting donations — costs
 * nothing, is honest at every moment, and leaves the flag with exactly one job:
 * deciding whether the page is published. While it is off the page carries
 * `noindex`, and it is not in `sitemap.ts` or the nav in either state.
 *
 * Figures: none are invented here. Constitution rule 2 applies to this page as
 * much as to a record — an unsourced number is omitted, not estimated. When
 * there are real running costs to publish, they get published, with the same
 * sourcing standard as everything else.
 */

const DESCRIPTION =
  "What Tirtha Atlas costs to run, why it might one day ask for support, and what it will never do to pay for itself.";

export const metadata: Metadata = {
  title: "Supporting Tirtha Atlas",
  description: DESCRIPTION,
  // Unpublished work should not be in an index. Both the flag and this metadata
  // are resolved at build time, so the deployment that publishes the page is the
  // same one that makes it indexable.
  robots: FLAGS.support ? undefined : { index: false, follow: false },
};

export default function Support() {
  return (
    <PageShell>
      <div className="eyebrow">
        {FLAGS.support ? "Support" : "Support · draft, not published"}
      </div>
      <h1>Supporting Tirtha Atlas</h1>

      <div className="supportnote">
        <p>
          <b>Tirtha Atlas is not accepting donations.</b> There is no payment
          provider, no subscription, and nothing on this site to buy. If you find
          a page anywhere asking for money on this project&rsquo;s behalf, it is
          not us.
        </p>
      </div>

      <p className="ink">
        This page exists so that the question is answered in public rather than
        left to inference. People reasonably want to know who pays for a free
        reference work, and what that buys the payer. Here is the whole of it.
      </p>

      <h2>What this is</h2>
      <p>
        Tirtha Atlas is a cited encyclopedia and time-map of the sacred geography
        of the Indic world — {SITES.length} temples and sacred sites across India,
        Nepal, Bhutan, Sri Lanka and the wider sphere, each carrying its dating,
        its dynasty, its documented history, its legend kept plainly separate
        from that history, and its sources. It is a public reference, free to
        read, with no account, no paywall and no tracking of who reads what.
      </p>
      <p>
        The corpus is compiled from open material — Natural Earth, Wikipedia and
        Wikidata, UNESCO listings, the Archaeological Survey of India, state
        temple boards and official trusts — and is published back under CC BY-SA
        4.0. It takes from the commons and returns to it. The method, and its
        current weaknesses, are set out on the{" "}
        <Link href="/about">about &amp; methodology</Link> page.
      </p>

      <h2>What it costs to run</h2>
      <p>
        Little, and not nothing. The site is static: pages are built ahead of time
        and served as files, so there is no database to keep running and no
        per-visitor compute to pay for. The standing costs are the ordinary ones —
        a domain, hosting and bandwidth for the map geometry and page assets, and
        the checks that keep the corpus honest, which re-verify sources and file
        an issue when a citation goes dead.
      </p>
      <p>
        The real cost is not infrastructure. It is the editorial work: reading
        sources, reconciling dates that three references give three different
        ways, finding a second citation for a record resting on one, writing to
        temple trusts to confirm a phone number rather than copying it off a
        listings site, and refusing to publish the ones that cannot be confirmed.
        That is slow, and it is the entire value of the project. No figures are
        given on this page because none have been published yet; when they are,
        they will be real ones.
      </p>

      <h2>Why it might one day ask for support</h2>
      <p>
        The roadmap is to raise records off single-source citation, to ingest
        Wikidata and OpenStreetMap and grow from {SITES.length} records toward tens
        of thousands, and to publish Indic-language editions. Each of those is
        bounded by editorial hours, not by servers. Support, if it is ever taken,
        would buy those hours — and would be reported the way everything else here
        is: with numbers, dated, and checkable.
      </p>

      <h2>What this project will not do</h2>
      <p>
        Whatever is decided, some things are settled. No advertising. No
        tracking or selling of reader data. No paywall over the corpus, and no
        licence change that takes it back out of the commons. No paid placement:
        no temple, trust or tourism body can buy an entry, buy a better one, or
        buy the removal of a sourced fact it dislikes. If a donor ever wanted
        influence over what a record says, the answer is no, and the record would
        say so.
      </p>

      <h2>How you can help today</h2>
      <p>
        By correcting it. {SITES.length} records is a lot of dates, spellings and
        attributions to get right, and a good many are not yet right. A correction
        that arrives with a source — a published reference, an official temple
        site, an inscription report — is worth more to this project than money is,
        because it is the thing money would be spent buying. Contribution with a
        verification queue is the next thing being built; until it lands,
        corrections go through the repository.
      </p>

      {!FLAGS.support && (
        <p className="vnote">
          Draft — not published. Set NEXT_PUBLIC_SUPPORT_PAGE=1 to publish this
          page; that switch does not, and cannot, start accepting money.
        </p>
      )}
    </PageShell>
  );
}
