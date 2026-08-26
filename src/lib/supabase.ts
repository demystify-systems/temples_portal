/**
 * DORMANT in v1 — the site builds fully static from data/sites.json.
 * When you're ready to activate the database layer:
 *   1. Create a Supabase project (or a `temples` schema in an existing one).
 *   2. Apply supabase/migrations/0001_init.sql
 *   3. Set env vars from .env.example
 *   4. npm run db:seed
 * No @supabase/supabase-js dependency is installed until then, so this file
 * exposes a REST helper that works with only fetch + env vars.
 */
export function supabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function sbRest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!supabaseConfigured()) throw new Error("Supabase env vars not set — v1 runs static-only.");
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
