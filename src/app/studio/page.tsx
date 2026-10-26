import { redirect } from 'next/navigation';

/**
 * The studio's multi-file explorer, terminal and Git tools now live in the
 * workspace at /. Keep old links working, including what they open
 * (?template=, ?kit=, ?project=, ?share=).
 */
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const v of [value].flat()) if (v !== undefined) params.append(key, v);
  }
  const query = params.toString();
  redirect(query ? `/?${query}` : '/');
}
