/**
 * Plans and prices, in one place: the pricing page, the comparison table and
 * the FAQ read from here. Checkout links come from the environment
 * (NEXT_PUBLIC_CHECKOUT_PRO_URL, NEXT_PUBLIC_CHECKOUT_PREMIUM_URL,
 * NEXT_PUBLIC_SALES_URL); until they are set, paid plans say so and point to
 * the free studio, which has no limits on what you can build.
 */

export type PlanId = 'free' | 'pro' | 'premium';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** US dollars per month (per seat for Premium); null = free */
  monthly: number | null;
  /** Per month when billed yearly */
  yearly: number | null;
  perSeat: boolean;
  cta: string;
  highlight?: boolean;
  /** The short list on the card */
  includes: string[];
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'The whole studio, on your machine, with your own model.',
    monthly: null,
    yearly: null,
    perSeat: false,
    cta: 'Start building',
    includes: [
      'Editor, terminal, git, preview and history',
      '40+ languages and runtimes, smart contracts included, toolchains installed and patched for you',
      'The agent, with proposals you review and evidence that they work',
      'Live values: what every line did, on the code, as you type',
      'Contracts: rules the agent is held to, and evidence for every changed line',
      'Full apps in 12 stacks and every CSS framework, with a live preview',
      'Debug this, on any failure',
      'The worker in Suggest mode',
      'Field kits: the built-in ones, and any you’re sent',
      'Any model: your key, a free tier or a local one',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For developers who want the AI working while they do.',
    monthly: 16,
    yearly: 12,
    perSeat: false,
    cta: 'Get Pro',
    highlight: true,
    includes: [
      'Everything in Free',
      'The worker in Autonomous mode',
      'Automatic debugging of every new failure',
      'Best-of-3: each task raced three ways, the verified one recommended',
      'A second reviewer on every proposal',
      'CI on every save, and the morning report',
      'Export your own field kits',
      'The native app for macOS, Windows and Linux',
      'Email support',
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    tagline: 'For forward-deployed, ISV and platform teams.',
    monthly: 39,
    yearly: 32,
    perSeat: true,
    cta: 'Talk to us',
    includes: [
      'Everything in Pro, for every seat',
      'A private kit library for your team',
      'Publish kits to your customers and developers',
      'Single sign-on and an audit log',
      'Team contracts and a model policy across every repo',
      'Cloud workers that keep going when your laptop sleeps',
      'Help deploying in your cloud or air-gapped',
      'Priority support with a named engineer',
    ],
  },
];

/** What is shipping today vs. on the way, so the page never oversells */
export const COMING_SOON = new Set([
  'A private kit library for your team',
  'Publish kits to your customers and developers',
  'Single sign-on and an audit log',
  'Team contracts and a model policy across every repo',
  'Cloud workers that keep going when your laptop sleeps',
]);

type Cell = boolean | string;
export const COMPARISON: { group: string; rows: { label: string; free: Cell; pro: Cell; premium: Cell }[] }[] = [
  {
    group: 'Build',
    rows: [
      { label: 'Editor, terminal, git, history', free: true, pro: true, premium: true },
      { label: 'Languages (incl. Solidity, Vyper, Move, Cairo)', free: '40+', pro: '40+', premium: '40+' },
      { label: 'Toolchains installed and kept patched', free: true, pro: true, premium: true },
      { label: 'Web apps: dev servers and in-browser preview', free: true, pro: true, premium: true },
      { label: 'TypeScript to native binaries (scriptc)', free: true, pro: true, premium: true },
      { label: 'Full apps in 12 stacks, every CSS framework', free: true, pro: true, premium: true },
      { label: 'Live values on the code as you type', free: true, pro: true, premium: true },
      { label: 'Why-history: the reason behind every line', free: true, pro: true, premium: true },
    ],
  },
  {
    group: 'AI',
    rows: [
      { label: 'Agent with proposals and evidence', free: true, pro: true, premium: true },
      { label: 'Bring your own model (keys stay in your browser)', free: true, pro: true, premium: true },
      { label: 'Debug this', free: true, pro: true, premium: true },
      { label: 'Automatic debugging', free: false, pro: true, premium: true },
      { label: 'Worker', free: 'Suggest', pro: 'Autonomous', premium: 'Autonomous' },
      { label: 'Best-of-3 approaches', free: false, pro: true, premium: true },
      { label: 'Contracts and evidence per changed line', free: true, pro: true, premium: true },
      { label: 'Second reviewer on every proposal', free: false, pro: true, premium: true },
      { label: 'CI on every save', free: false, pro: true, premium: true },
      { label: 'Morning report', free: false, pro: true, premium: true },
      { label: 'Cloud workers', free: false, pro: false, premium: 'Soon' },
    ],
  },
  {
    group: 'Teams and field work',
    rows: [
      { label: 'Built-in field kits', free: true, pro: true, premium: true },
      { label: 'Open kits from your team or vendors', free: true, pro: true, premium: true },
      { label: 'Export your own kits', free: false, pro: true, premium: true },
      { label: 'Private kit library', free: false, pro: false, premium: 'Soon' },
      { label: 'SSO and audit log', free: false, pro: false, premium: 'Soon' },
      { label: 'Team contracts and model policy', free: false, pro: false, premium: 'Soon' },
      { label: 'Outcome analytics (verified rate, time saved)', free: false, pro: false, premium: 'Soon' },
      { label: 'Deployment help', free: false, pro: false, premium: true },
    ],
  },
  {
    group: 'Apps and support',
    rows: [
      { label: 'Runs in the browser, self-hosted', free: true, pro: true, premium: true },
      { label: 'Native app for macOS, Windows and Linux', free: false, pro: true, premium: true },
      { label: 'Support', free: 'Community', pro: 'Email', premium: 'Priority, named engineer' },
    ],
  },
];

export const PRICING_FAQ = [
  {
    q: 'Do I pay for the AI too?',
    a: 'Not to us. Every plan uses the model you choose: your own Anthropic or OpenAI key, a free tier (Gemini, Groq, OpenRouter) or a local model in Ollama. Your keys stay in your browser and go only to the provider you picked.',
  },
  {
    q: 'Is Free really free?',
    a: 'Yes, with no time limit and no cap on projects, languages or runs. Free is the full studio; Pro and Premium add the autonomous features, the native app and team features.',
  },
  {
    q: 'Where does my code go?',
    a: 'Nowhere we can see it. The studio runs on your machine (or your server), projects live in your browser and on disk, and the agent talks directly to your model provider.',
  },
  {
    q: 'Can I switch plans or cancel?',
    a: 'Any time. Yearly plans are billed up front at the lower monthly price; you keep everything you built when you switch back to Free.',
  },
  {
    q: 'What counts as a seat on Premium?',
    a: 'Each person who signs in. Customers who open a kit you published don’t need a seat.',
  },
];

export interface Checkout {
  href: string;
  label: string;
  /** False until a checkout link is configured */
  live: boolean;
}

/** Where a plan's button goes */
export function checkoutFor(plan: Plan, env: Record<string, string | undefined>): Checkout {
  if (plan.id === 'free') return { href: '/onboarding', label: plan.cta, live: true };
  const url = plan.id === 'pro' ? env.NEXT_PUBLIC_CHECKOUT_PRO_URL : env.NEXT_PUBLIC_CHECKOUT_PREMIUM_URL || env.NEXT_PUBLIC_SALES_URL;
  if (url && /^https:\/\/\S+$/.test(url)) return { href: url, label: plan.cta, live: true };
  return { href: '/onboarding', label: 'Start free · upgrade soon', live: false };
}

/** "$12" / "Free" */
export function priceLabel(plan: Plan, billing: 'monthly' | 'yearly'): string {
  const price = billing === 'yearly' ? plan.yearly : plan.monthly;
  return price === null ? '$0' : `$${price}`;
}

/** What you save per year by paying yearly, in dollars per seat */
export function yearlySaving(plan: Plan): number {
  return plan.monthly === null || plan.yearly === null ? 0 : (plan.monthly - plan.yearly) * 12;
}
