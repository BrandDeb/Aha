/**
 * Prettier, loaded on demand so it doesn't weigh down first paint.
 */
import type { Settings } from './store';

export function canFormat(filePath: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|json|md|css|html)$/.test(filePath);
}

export async function formatSource(filePath: string, source: string, settings: Settings): Promise<string> {
  const [prettier, estree, typescript, babel, markdown, postcss, html] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/markdown'),
    import('prettier/plugins/postcss'),
    import('prettier/plugins/html'),
  ]);
  const parser = /\.(?:ts|tsx|mts|cts)$/.test(filePath)
    ? 'typescript'
    : filePath.endsWith('.json')
      ? 'json'
      : filePath.endsWith('.md')
        ? 'markdown'
        : filePath.endsWith('.css')
          ? 'css'
          : filePath.endsWith('.html')
            ? 'html'
            : 'babel';
  return prettier.format(source, {
    parser,
    plugins: [estree, typescript, babel, markdown, postcss, html],
    semi: settings.semi,
    singleQuote: settings.singleQuote,
    printWidth: settings.printWidth,
    tabWidth: settings.tabWidth,
  });
}
