import { FAQS } from '@/lib/faq';
import { PLANS } from '@/lib/pricing';
import { llmsTxt, siteUrl } from '@/lib/site';
import { loadDocs } from '../docs/load';

/** llms.txt: the site, summarised for language models (llmstxt.org) */
export function GET() {
  return new Response(llmsTxt(siteUrl(), loadDocs(), FAQS, PLANS), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
