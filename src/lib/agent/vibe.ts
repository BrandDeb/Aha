/**
 * The vibe dial: one setting from "just make it work" to "explain every line". It shapes what the agent is told
 * (how much it explains, and when it stops to ask) and how deep the second reviewer looks. The middle stop changes
 * nothing, so the agent behaves as it always has unless you turn the dial. Pure.
 */

export type Vibe = 'ship' | 'balanced' | 'explain' | 'every-line';

export const VIBES: { id: Vibe; label: string; detail: string }[] = [
  { id: 'ship', label: 'Just make it work', detail: 'It decides for you, asks only when it is truly stuck, and reports in two lines. The reviewer looks for blockers only.' },
  { id: 'balanced', label: 'Balanced', detail: 'Its usual judgement: asks when a choice is yours, summarises what changed and how it checked it.' },
  { id: 'explain', label: 'Explain', detail: 'It says what each change does and why, and asks before choices you would notice. The reviewer also flags code that is hard to follow.' },
  { id: 'every-line', label: 'Explain every line', detail: 'It walks through every changed line in plain words, comments what is not obvious, and asks before each design choice. The reviewer reads for clarity too.' },
];

export const DEFAULT_VIBE: Vibe = 'balanced';
export const isVibe = (v: unknown): v is Vibe => VIBES.some((x) => x.id === v);

const BRIEF: Record<Vibe, string> = {
  ship: `How the user wants to work (vibe: just make it work): they want a result, not a conversation. Make reasonable choices yourself (names, structure, small libraries) and keep going; ask only when you cannot continue without something only they know. Verify as always. Finish with at most two lines: what now works, and how you checked it.`,
  balanced: '',
  explain: `How the user wants to work (vibe: explain): they want to understand the change. In your final summary, for each file you changed, say in plain words what the change does and why it is needed, then how you checked it. Before a choice the user would notice (a new dependency, a different approach, changed behaviour), stop and ask with a short list of options instead of picking one.`,
  'every-line': `How the user wants to work (vibe: explain every line): they are learning from this change. In your final summary, walk through every changed line or small block, in order, file by file: quote it briefly and explain what it does and why it is written that way, in plain words a beginner can follow. Add a short code comment wherever a line is not obvious on its own. Before each design choice with more than one reasonable answer, stop and ask, listing the options and what each would mean.`,
};

const REVIEW: Record<Vibe, string> = {
  ship: `\n\nThe user chose "just make it work": report only blockers and major problems. Do not list minor notes; approve a change that works.`,
  balanced: '',
  explain: `\n\nThe user chose "explain": they read this code to learn it. Besides bugs, flag (as minor) code that is hard to follow: unclear names, clever one-liners, missing explanation for something surprising.`,
  'every-line': `\n\nThe user chose "explain every line": they read this code to learn it. Besides bugs, flag (as minor) every unclear name, every non-obvious line without a comment, and anything a beginner would not understand, with the clearer version as the fix.`,
};

/** The section added to the agent's instructions (empty for the middle stop) */
export const vibeBrief = (vibe: Vibe = DEFAULT_VIBE) => BRIEF[vibe] ?? '';

/** The reviewer's instructions for this vibe */
export const reviewerPromptFor = (base: string, vibe: Vibe = DEFAULT_VIBE) => base + (REVIEW[vibe] ?? '');
