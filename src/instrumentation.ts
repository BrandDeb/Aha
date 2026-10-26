/**
 * Runs once when the server starts:
 * - the autopilot (self-healing, and opt-in self-updating) looks after the studio while it runs
 * - the toolchains the studio installed are kept up to date (checked soon after start and every
 *   12 hours), but only where the studio runs programs at all, which is on your own machine
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { scheduleAutopilot } = await import('./lib/autopilot');
  scheduleAutopilot();
  const { isRunEnabled } = await import('./lib/polyglot');
  if (!isRunEnabled()) return;
  const { scheduleToolchainUpdates } = await import('./lib/toolchains');
  scheduleToolchainUpdates();
}
