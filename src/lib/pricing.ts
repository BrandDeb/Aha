/**
 * Plans and prices, in one place: the pricing page, the comparison table and
 * the FAQ read from here. Checkout links come from the environment
 * (NEXT_PUBLIC_CHECKOUT_PRO_URL, NEXT_PUBLIC_CHECKOUT_TEAM_URL,
 * NEXT_PUBLIC_CHECKOUT_BUSINESS_URL, NEXT_PUBLIC_SALES_URL); until they are set, paid
 * plans say so and point to the free studio, which has no limits on what you can
 * build. A Team trial needs no checkout: it starts from a signed-in account.
 */

export type PlanId = 'free' | 'pro' | 'team' | 'business' | 'enterprise';

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Who it is for, in a few words */
  audience: string;
  /** US dollars per month (per seat for team plans); null = free, or talk to us */
  monthly: number | null;
  /** Per month when billed yearly */
  yearly: number | null;
  perSeat: boolean;
  /** No list price: the button goes to sales */
  contact?: boolean;
  /** Fewest and most seats the plan is meant for */
  seats?: { min: number; max: number | null };
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
    audience: 'Anyone',
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
    audience: 'One developer',
    monthly: 16,
    yearly: 12,
    perSeat: false,
    cta: 'Get Pro',
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
    id: 'team',
    name: 'Team',
    tagline: 'One bill and one set of rules for a team that ships together.',
    audience: '2 to 50 developers',
    monthly: 24,
    yearly: 20,
    perSeat: true,
    seats: { min: 2, max: 50 },
    cta: 'Start a 14-day trial',
    highlight: true,
    includes: [
      'Everything in Pro, for every seat',
      'Shared project memory, contracts, kits and skills',
      'Receipts for every change, shared across the team',
      'A team night shift with one budget',
      'Sign in with your company’s Google Workspace or GitHub organisation',
      'Seat and spend-cap admin, and one invoice',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'For companies that need control over what agents can see and do.',
    audience: '25 to 250 developers',
    monthly: 45,
    yearly: 38,
    perSeat: true,
    seats: { min: 25, max: 250 },
    cta: 'Talk to us',
    includes: [
      'Everything in Team',
      'SAML single sign-on and SCIM provisioning',
      'An audit log of what agents read, ran and sent',
      'Policies: which models, local-only mode, which connectors',
      'The agent benchmark, run on your own repository',
      'Priority support with a response-time commitment',
      'Invoice and purchase-order billing',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'For organisations that run it themselves, on their own terms.',
    audience: '250+ developers',
    monthly: null,
    yearly: null,
    perSeat: true,
    contact: true,
    seats: { min: 250, max: null },
    cta: 'Talk to us',
    includes: [
      'Everything in Business',
      'Self-hosting in your cloud or air-gapped',
      'Publish kits to your customers and developers',
      'Custom terms and security review',
      'Help deploying, and a named engineer',
    ],
  },
];

/** What is shipping today vs. on the way, so the page never oversells */
export const COMING_SOON = new Set([
  'Shared project memory, contracts, kits and skills',
  'Receipts for every change, shared across the team',
  'A team night shift with one budget',
  'Sign in with your company’s Google Workspace or GitHub organisation',
  'Seat and spend-cap admin, and one invoice',
  'SAML single sign-on and SCIM provisioning',
  'An audit log of what agents read, ran and sent',
  'Policies: which models, local-only mode, which connectors',
  'The agent benchmark, run on your own repository',
  'Invoice and purchase-order billing',
  'Publish kits to your customers and developers',
]);

type Cell = boolean | string;
/** One row of the comparison: a cell for each plan, in PLANS order */
export interface CompareRow {
  label: string;
  cells: [Cell, Cell, Cell, Cell, Cell];
}

const all = (v: Cell): CompareRow['cells'] => [v, v, v, v, v];
const paid = (v: Cell): CompareRow['cells'] => [false, v, v, v, v];
const teams = (v: Cell): CompareRow['cells'] => [false, false, v, v, v];

export const COMPARISON: { group: string; rows: CompareRow[] }[] = [
  {
    group: 'Build',
    rows: [
      { label: 'Editor, terminal, git, history', cells: all(true) },
      { label: 'Languages (incl. Solidity, Vyper, Move, Cairo)', cells: all('40+') },
      { label: 'Toolchains installed and kept patched', cells: all(true) },
      { label: 'Web apps: dev servers and in-browser preview', cells: all(true) },
      { label: 'TypeScript to native binaries (scriptc)', cells: all(true) },
      { label: 'Full apps in 12 stacks, every CSS framework', cells: all(true) },
      { label: 'Live values on the code as you type', cells: all(true) },
      { label: 'Why-history: the reason behind every line', cells: all(true) },
    ],
  },
  {
    group: 'AI',
    rows: [
      { label: 'Agent with proposals and evidence', cells: all(true) },
      { label: 'Bring your own model (keys stay in your browser)', cells: all(true) },
      { label: 'Debug this', cells: all(true) },
      { label: 'Automatic debugging', cells: paid(true) },
      { label: 'Worker', cells: ['Suggest', 'Autonomous', 'Autonomous', 'Autonomous', 'Autonomous'] },
      { label: 'Best-of-3 approaches', cells: paid(true) },
      { label: 'Contracts and evidence per changed line', cells: all(true) },
      { label: 'Second reviewer on every proposal', cells: paid(true) },
      { label: 'CI on every save', cells: paid(true) },
      { label: 'Morning report', cells: paid(true) },
    ],
  },
  {
    group: 'Teams',
    rows: [
      { label: 'Seats', cells: ['1', '1', '2 to 50', '25 to 250', '250+'] },
      { label: 'Shared project memory, contracts, kits and skills', cells: teams('Soon') },
      { label: 'Receipts shared across the team', cells: teams('Soon') },
      { label: 'Team night shift with one budget', cells: teams('Soon') },
      { label: 'Google Workspace or GitHub organisation sign-in', cells: teams('Soon') },
      { label: 'Seat and spend-cap admin, one invoice', cells: teams('Soon') },
      { label: 'Built-in field kits', cells: all(true) },
      { label: 'Export your own kits', cells: paid(true) },
    ],
  },
  {
    group: 'Control and security',
    rows: [
      { label: 'SAML single sign-on and SCIM', cells: [false, false, false, 'Soon', 'Soon'] },
      { label: 'Audit log of what agents read, ran and sent', cells: [false, false, false, 'Soon', 'Soon'] },
      { label: 'Model, local-only and connector policies', cells: [false, false, false, 'Soon', 'Soon'] },
      { label: 'Agent benchmark on your own repository', cells: [false, false, false, 'Soon', 'Soon'] },
      { label: 'Self-hosting in your cloud or air-gapped', cells: [true, true, true, true, true] },
      { label: 'Publish kits to your customers', cells: [false, false, false, false, 'Soon'] },
    ],
  },
  {
    group: 'Apps and support',
    rows: [
      { label: 'Runs in the browser, self-hosted', cells: all(true) },
      { label: 'Native app for macOS, Windows and Linux', cells: paid(true) },
      { label: 'Support', cells: ['Community', 'Email', 'Email', 'Priority, response-time commitment', 'Named engineer'] },
      { label: 'Billing', cells: ['None', 'Card', 'Card, one invoice', 'Invoice or purchase order', 'Custom terms'] },
    ],
  },
];

export const PRICING_FAQ = [
  {
    q: 'Do I pay for the AI too?',
    a: 'Not to us. Every plan uses the model you choose: your own Anthropic or OpenAI key, a free tier (Gemini, Groq, OpenRouter) or a local model in Ollama. Your keys stay in your browser and go only to the provider you picked. Seats pay for the studio, not for tokens.',
  },
  {
    q: 'Is Free really free?',
    a: 'Yes, with no time limit and no cap on projects, languages or runs. Free is the full studio; the paid plans add the autonomous features, the native app and team features.',
  },
  {
    q: 'Where does my code go?',
    a: 'Nowhere we can see it. The studio runs on your machine (or your server), projects live in your browser and on disk, and the agent talks directly to your model provider.',
  },
  {
    q: 'How does the Team trial work?',
    a: 'Sign in with GitHub or Google, start the trial from the pricing page and invite your team. It lasts 14 days and needs no card. If you do nothing, the team goes back to Free and keeps everything it built.',
  },
  {
    q: 'What counts as a seat?',
    a: 'Each person who works in the studio. Reviewers who only open receipts and approve proposals are free.',
  },
  {
    q: 'Is there a discount?',
    a: 'Yearly billing is already in the lower price. Startups under two years old and non-profits get 50% off Team and Business.',
  },
  {
    q: 'Can I switch plans or cancel?',
    a: 'Any time. Yearly plans are billed up front at the lower monthly price; you keep everything you built when you switch back to Free.',
  },
  {
    q: 'Which plan do I need for more than 50 people?',
    a: 'Business, from 25 developers up to 250, adds single sign-on, an audit log and policies. Beyond 250, or for self-hosting with custom terms, Enterprise.',
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
  // A Team trial starts from a signed-in account, with no card
  if (plan.id === 'team') {
    const url = env.NEXT_PUBLIC_CHECKOUT_TEAM_URL;
    if (url && /^https:\/\/\S+$/.test(url)) return { href: url, label: 'Buy Team', live: true };
    return { href: '/billing', label: plan.cta, live: true };
  }
  const url =
    plan.id === 'pro' ? env.NEXT_PUBLIC_CHECKOUT_PRO_URL : plan.id === 'business' ? env.NEXT_PUBLIC_CHECKOUT_BUSINESS_URL || env.NEXT_PUBLIC_SALES_URL : env.NEXT_PUBLIC_SALES_URL;
  if (url && /^https:\/\/\S+$/.test(url)) return { href: url, label: plan.cta, live: true };
  return { href: '/onboarding', label: 'Start free · upgrade soon', live: false };
}

/** "$12" / "Free" / "Custom" */
export function priceLabel(plan: Plan, billing: 'monthly' | 'yearly'): string {
  if (plan.contact) return 'Custom';
  const price = billing === 'yearly' ? plan.yearly : plan.monthly;
  return price === null ? '$0' : `$${price}`;
}

/** What you save per year by paying yearly, in dollars per seat */
export function yearlySaving(plan: Plan): number {
  return plan.monthly === null || plan.yearly === null ? 0 : (plan.monthly - plan.yearly) * 12;
}

export interface Quote {
  seats: number;
  /** Dollars per month, for the whole team, before tax */
  perMonth: number;
  /** Dollars per year when billed yearly */
  perYear: number;
  /** Seats outside the plan's range, if any: the plan to look at instead */
  suggest?: PlanId;
}

/** What a team of this size pays: `seats` times the per-seat price, half off for a startup or non-profit */
export function quote(plan: Plan, seats: number, billing: 'monthly' | 'yearly', discounted = false): Quote | null {
  if (!plan.perSeat || plan.contact || plan.monthly === null || plan.yearly === null) return null;
  const n = Math.max(1, Math.floor(seats));
  const unit = (billing === 'yearly' ? plan.yearly : plan.monthly) * (discounted ? 0.5 : 1);
  const perMonth = Math.round(unit * n * 100) / 100;
  const out: Quote = { seats: n, perMonth, perYear: Math.round(perMonth * 12 * 100) / 100 };
  if (plan.seats && n < plan.seats.min) out.suggest = plan.id === 'business' ? 'team' : 'pro';
  else if (plan.seats?.max && n > plan.seats.max) out.suggest = plan.id === 'team' ? 'business' : 'enterprise';
  return out;
}
