import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editorLanguage, parseJsonc, projectRecommendations, readPack, readSnippets, splitId, themeToEditor } from '../src/lib/extensions.ts';

const meta = { namespace: 'acme', name: 'night', version: '1.2.3' };

// Shaped like a real theme extension (comments, an include, a theme for each mode)
const themePackage = {
  'extension/package.json': JSON.stringify({
    name: 'night',
    displayName: 'Acme Night',
    publisher: 'acme',
    description: 'A dark theme',
    contributes: {
      themes: [
        { label: 'Acme Night', uiTheme: 'vs-dark', path: './themes/night.json' },
        { label: 'Acme Day', uiTheme: 'vs', path: './themes/day.json' },
        { label: 'Old style', uiTheme: 'vs-dark', path: './themes/old.tmTheme' },
      ],
    },
  }),
  'extension/themes/base.json': '{ "colors": { "editor.background": "#101010", "editor.foreground": "#eeeeee" }, "tokenColors": [ { "scope": "comment", "settings": { "foreground": "#777777", "fontStyle": "italic" } } ] }',
  'extension/themes/night.json': `{
    // a comment
    "include": "./base.json",
    "colors": { "editor.background": "#000000", "not.a.colour": "red", },
    "tokenColors": [
      { "scope": ["keyword", "storage.type"], "settings": { "foreground": "#FF79C6" } },
      { "scope": "string.quoted.double", "settings": { "foreground": "#f1fa8c" } },
      { "scope": "keyword.control.flow", "settings": { "foreground": "#123456" } },
      { "scope": "source.js keyword", "settings": { "foreground": "#000000" } },
      { "scope": "constant.numeric", "settings": { "foreground": "#BD93F9AA" } },
      { "scope": "entity.name.type.class", "settings": { "fontStyle": "bold" } },
      /* trailing comma next */
    ],
  }`,
  'extension/themes/day.json': '{ "colors": { "editor.foreground": "#123" }, "tokenColors": [] }',
  'extension/themes/old.tmTheme': '<plist/>',
};

test('JSON with comments and trailing commas; strings keep their slashes', () => {
  assert.deepEqual(parseJsonc('{ "url": "https://x.dev/a//b", /* c */ "a": [1, 2,], // end\n }'), { url: 'https://x.dev/a//b', a: [1, 2] });
  assert.deepEqual(parseJsonc('{"q": "say \\"hi\\" // not a comment"}'), { q: 'say "hi" // not a comment' });
  assert.throws(() => parseJsonc('{ nope }'));
});

test('themes: include merged, the most general scope per token, scopes mapped to editor tokens, only valid colours, both modes', () => {
  const pack = readPack(themePackage, meta);
  assert.equal(pack.id, 'acme.night');
  assert.equal(pack.displayName, 'Acme Night');
  assert.deepEqual(pack.themes.map((t) => [t.id, t.label, t.dark, t.data.base]), [
    ['acme.night/0', 'Acme Night', true, 'vs-dark'],
    ['acme.night/1', 'Acme Day', false, 'vs'],
  ], 'a .tmTheme (XML) is left out');
  const night = pack.themes[0].data;
  assert.deepEqual(night.colors, { 'editor.background': '#000000', 'editor.foreground': '#eeeeee' }, 'own colours override the included ones; "red" is not a hex colour');
  assert.deepEqual(night.rules, [
    { token: '', foreground: 'eeeeee' },
    { token: 'comment', foreground: '777777', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', fontStyle: 'bold' },
  ]);
  assert.deepEqual(pack.themes[1].data.rules, [{ token: '', foreground: '112233' }], 'short hex expanded');
  assert.deepEqual(pack.unsupported, []);
});

test('snippets: prefixes, scoped languages, React flavours mapped, duplicates across languages merged', () => {
  const generated = {
    reactArrowFunctionExportComponent: { prefix: 'rafce', body: ['const ${1:${TM_FILENAME_BASE}} = () => {', '  return <div>$0</div>', '}'], description: 'Arrow function component', scope: 'javascript,javascriptreact,typescript,typescriptreact' },
    useState: { prefix: ['useState', 'ust'], body: 'const [$1, set$1] = useState($2)' },
    broken: { prefix: '', body: 'x' },
    noBody: { prefix: 'nb' },
  };
  const files = {
    'extension/package.json': JSON.stringify({
      name: 'snips',
      main: './lib/index.js',
      contributes: {
        commands: [{ command: 'snips.search' }],
        keybindings: [{ command: 'snips.search', key: 'ctrl+alt+r' }],
        snippets: [
          { language: 'javascriptreact', path: './lib/generated.json' },
          { language: 'typescriptreact', path: './lib/generated.json' },
          { language: 'typescript', path: '../../etc/passwd' },
        ],
      },
    }),
    'extension/lib/generated.json': JSON.stringify(generated),
  };
  const pack = readPack(files, { namespace: 'ds', name: 'snips', version: '4.0.0' });
  assert.deepEqual(pack.snippets.map((s) => [s.prefix, s.languages.join(',')]), [
    ['rafce', 'javascript,typescript'],
    ['useState', 'javascript,typescript'],
    ['ust', 'javascript,typescript'],
  ]);
  assert.equal(pack.snippets[0].body, 'const ${1:${TM_FILENAME_BASE}} = () => {\n  return <div>$0</div>\n}');
  assert.equal(pack.snippets[0].description, 'Arrow function component');
  assert.equal(pack.snippets[1].description, 'useState', 'the snippet name when there is no description');
  assert.deepEqual(pack.unsupported, ['code that runs inside VS Code (the studio never runs extension code)', 'commands', 'keybindings for its own commands']);
  assert.deepEqual(readSnippets([1, 2], 'x'), []);
  assert.equal(editorLanguage('typescriptreact'), 'typescript');
  assert.equal(editorLanguage('python'), 'python');
});

test('a code-only extension gives nothing usable and says why', () => {
  const pack = readPack({ 'extension/package.json': JSON.stringify({ name: 'vim', main: './out/extension', contributes: { commands: [{}], keybindings: [{}], configuration: {} } }) }, { namespace: 'vscodevim', name: 'vim', version: '1.0.0' });
  assert.deepEqual([pack.themes.length, pack.snippets.length], [0, 0]);
  assert.match(pack.unsupported[0], /never runs extension code/);
  assert.throws(() => readPack({}, meta), /no extension\/package.json/);
});

test('themeToEditor: high contrast bases, the default foreground from an unscoped rule', () => {
  const data = themeToEditor({ tokenColors: [{ settings: { foreground: '#abcdef' } }, { scope: 'keyword', settings: {} }] }, 'hc-black');
  assert.equal(data.base, 'hc-black');
  assert.deepEqual(data.rules, [{ token: '', foreground: 'abcdef' }], 'a rule with no colour or style is dropped');
});

test('recommendations from .vscode/extensions.json, and ids', () => {
  assert.deepEqual(projectRecommendations({ '.vscode/extensions.json': '{ // the team uses these\n "recommendations": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode", "not an id", 3,] }' }), ['dbaeumer.vscode-eslint', 'esbenp.prettier-vscode']);
  assert.deepEqual(projectRecommendations({ '.vscode/extensions.json': 'broken' }), []);
  assert.deepEqual(splitId('GitHub.github-vscode-theme'), { namespace: 'GitHub', name: 'github-vscode-theme' });
  assert.equal(splitId('nope'), null);
});
