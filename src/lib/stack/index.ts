/**
 * The stack builder: a choice of framework, styling and libraries becomes a
 * runnable project with every dependency listed and wired in. See catalog.ts
 * for the choices and the rules between them.
 */

import { resolveStack, type StackChoice } from './catalog.ts';
import { pythonProject, uvCommands } from './python.ts';
import { installCommands, stackSummary, webProject } from './web.ts';

export * from './catalog.ts';
export { stackSummary, webDependencies } from './web.ts';
export { pythonDependencies } from './python.ts';

export interface BuiltStack {
  choice: StackChoice;
  /** What resolving the choice changed, in words ("React Router replaced by TanStack Router.") */
  notes: string[];
  files: Record<string, string>;
  entry: string;
  /** One line naming the stack */
  summary: string;
  /** The install commands that give the same dependencies (npm install …, uv add …) */
  commands: string[];
}

export function buildStack(input: StackChoice): BuiltStack {
  const { choice, notes } = resolveStack(input);
  if (choice.kind === 'python') {
    const { files, entry } = pythonProject(choice);
    return { choice, notes, files, entry, summary: files['README.md'].split('\n')[2], commands: uvCommands(choice) };
  }
  const { files, entry } = webProject(choice);
  return { choice, notes, files, entry, summary: stackSummary(choice), commands: installCommands(choice) };
}
