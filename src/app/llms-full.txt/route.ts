import { FAQS } from '@/lib/faq';
import { PLANS } from '@/lib/pricing';
import { llmsTxt, siteUrl } from '@/lib/site';
import { loadDocs } from '../docs/load';

/** llms-full.txt: llms.txt plus the full text of every docs page and FAQ answer */
export function GET() {
  return new Response(llmsTxt(siteUrl(), loadDocs(), FAQS, PLANS, true), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
