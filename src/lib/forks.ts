/**
 * Fork the future: one request, several deliberately different versions built at the same time, each on its
 * own copy of the project, so you choose between real results (running side by side when it is a web app)
 * instead of describing what you want and hoping. Each fork is told its direction and that the others take
 * other ones, so they don't all converge on the same answer. Pure: the directions and the instructions.
 */

export interface ForkDirection {
  /** Short name on the lane: "Bold" */
  label: string;
  /** What the fork is told to commit to */
  direction: string;
}

const LOOK = /\b(page|landing|design|ui|ux|look|looks|style|styling|layout|hero|theme|colou?rs?|button|card|header|footer|navbar|nav|homepage|screen|dashboard|form|modal|website|site|portfolio|pretty|beautiful|redesign)\b/i;

/** Directions for a change to how something looks */
export const DESIGN_DIRECTIONS: ForkDirection[] = [
  { label: 'Minimal', direction: 'Minimal and calm: generous whitespace, a restrained palette (one accent colour), quiet typography, nothing decorative that does not help.' },
  { label: 'Bold', direction: 'Bold and vivid: strong colour, large confident type, high contrast, a clear focal point; it should feel energetic.' },
  { label: 'Playful', direction: 'Playful and friendly: rounded shapes, soft colours, small delightful touches (emoji or illustration-like accents, gentle motion), warm copy.' },
  { label: 'Editorial', direction: 'Editorial and elegant: a refined serif-and-sans pairing, careful hierarchy, thin rules and a magazine-like grid.' },
];

/** Directions for a change to how something works */
export const CODE_DIRECTIONS: ForkDirection[] = [
  { label: 'Simplest', direction: 'The simplest thing that works: the fewest lines and concepts, no new dependencies, easy to read in one pass.' },
  { label: 'Robust', direction: 'Robust: validate inputs, handle every error and edge case explicitly, and add tests that prove it.' },
  { label: 'Fast', direction: 'Fast: choose the approach with the best performance (time and memory), and say what makes it faster.' },
  { label: 'Extensible', direction: 'Extensible: clean boundaries and small, well-named pieces that the next feature can build on without rewriting.' },
];

/** Whether a request is about looks (design directions) or behaviour (code directions) */
export function isDesignRequest(goal: string): boolean {
  return LOOK.test(goal);
}

/** The directions to suggest for a request: n of them, design or code by what the request is about */
export function forkDirections(goal: string, n = 3): ForkDirection[] {
  const pool = isDesignRequest(goal) ? DESIGN_DIRECTIONS : CODE_DIRECTIONS;
  return pool.slice(0, Math.max(2, Math.min(pool.length, n)));
}

/** What one fork is asked to do */
export function forkGoal(goal: string, fork: ForkDirection, others: ForkDirection[]): string {
  const rest = others.filter((o) => o.label !== fork.label).map((o) => o.label.toLowerCase());
  return `${goal.trim()}

Take this direction and commit to it: ${fork.direction}
${rest.length ? `Other versions of this request are being built at the same time in other directions (${rest.join(', ')}), so do not hedge toward them: make this one clearly "${fork.label}".` : ''}
Keep to the request otherwise, make it work (build or run it to check), and finish with two sentences on what makes this version "${fork.label}".`.trim();
}

/** Lane ids for forks */
export const forkLaneId = (i: number) => `fork-${i + 1}`;
export const isForkLane = (id: string) => /^fork-\d+$/.test(id);
