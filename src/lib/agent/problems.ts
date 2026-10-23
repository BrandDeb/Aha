/**
 * What went wrong with a run, in terms of what you can do about it: a key the
 * provider rejected (fix the key), a rate limit or an empty balance (wait or
 * switch model), the model or the network being unreachable (try again), or a
 * model that doesn't exist (pick another). Pure, so it is tested directly.
 */

export type Problem = { kind: 'key' | 'quota' | 'model' | 'network'; title: string; detail: string };

export function problemOf(message: string | undefined): Problem | null {
  if (!message) return null;
  if (/rejected the API key|invalid[_ ]api[_ ]key|incorrect api key|\b401\b|unauthori[sz]ed|api key not valid/i.test(message)) {
    return { kind: 'key', title: 'The model provider rejected your API key', detail: 'Fix the key in Settings → Assistant, then try again. Nothing in your project changed.' };
  }
  if (/\b429\b|rate.?limit|quota|insufficient[_ ](?:quota|balance|credits)|credit balance|billing/i.test(message)) {
    return { kind: 'quota', title: 'The model provider is limiting requests', detail: 'Wait a moment and try again, or switch to another model or provider in Settings → Assistant.' };
  }
  if (/model[^.]{0,40}(?:not found|does not exist|is not available|not supported)|unknown model|\b404\b/i.test(message)) {
    return { kind: 'model', title: 'That model isn’t available', detail: 'Pick another model in Settings → Assistant.' };
  }
  if (/failed to fetch|network|ECONN|ETIMEDOUT|timed? ?out|\b50[234]\b|overloaded|unavailable/i.test(message)) {
    return { kind: 'network', title: 'The model couldn’t be reached', detail: 'Usually temporary: try again. If it keeps happening, check your connection or the provider’s status page.' };
  }
  return null;
}
