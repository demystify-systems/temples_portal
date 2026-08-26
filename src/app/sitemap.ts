import type { MetadataRoute } from "next";
import { SITES, allCircuits, allDynasties, slugify } from "@/lib/sites";

const base = process.env.NEXT_PUBLIC_SITE_URL || "https://temples-portal.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/sites`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${base}/circuits`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/dynasties`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    ...SITES.map((s) => ({ url: `${base}/site/${s.id}`, changeFrequency: "monthly" as const, priority: 0.9 })),
    ...allCircuits().map(([n]) => ({ url: `${base}/circuit/${slugify(n)}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...allDynasties().map(([n]) => ({ url: `${base}/dynasty/${slugify(n)}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
