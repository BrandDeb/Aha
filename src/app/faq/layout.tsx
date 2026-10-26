import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { JsonLd } from '@/components/JsonLd';
import { FAQS } from '@/lib/faq';
import { breadcrumbLd, faqLd, pageMeta, siteUrl } from '@/lib/site';

export const metadata: Metadata = pageMeta({
  title: 'FAQ',
  description: 'Answers about NanoCLI Studio: the agent and proposals, the worker, plans, languages, Python, GitHub, models and keys, self-hosting and security.',
  path: '/faq',
});

/** The FAQ page is interactive (search, filters); its questions and answers are also published as FAQPage data */
export default function FaqLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JsonLd data={[faqLd(FAQS), breadcrumbLd(siteUrl(), [{ name: 'Home', path: '/landing' }, { name: 'FAQ', path: '/faq' }])]} />
      {children}
    </>
  );
}
