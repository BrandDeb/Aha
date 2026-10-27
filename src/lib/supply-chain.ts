/**
 * The supply-chain guard: every dependency a proposal adds is checked before its risk score is computed. Offline, the
 * name is compared with the most-installed packages of its ecosystem (typosquats: one letter off, swapped, a separator
 * or look-alike character changed). With the registry's answer (fetched by the server), it also flags packages that
 * don't exist (a made-up name an attacker can register), install scripts, packages days old or barely downloaded,
 * known advisories (OSV) and licences that bind you. Every finding holds auto-accept. Pure: shared by the browser,
 * the server and the tests.
 */

import { readDependencies } from './agent/risk.ts';

export type Ecosystem = 'npm' | 'PyPI' | 'crates.io' | 'Go' | 'RubyGems' | 'Packagist';

export interface NewDependency {
  ecosystem: Ecosystem;
  name: string;
  /** The version spec as written ("^4.18.0", ">=2.31", "") */
  spec: string;
  /** The manifest it was added to */
  file: string;
}

export type FindingKind = 'typosquat' | 'missing' | 'install-script' | 'new' | 'unpopular' | 'advisory' | 'licence';

export interface SupplyFinding {
  ecosystem: Ecosystem;
  name: string;
  kind: FindingKind;
  /** One line, for the risk factor */
  detail: string;
}

/** What the registry and OSV say about a package; every field optional, since any lookup can fail */
export interface PackageFacts {
  ecosystem: Ecosystem;
  name: string;
  /** false: the registry has no package by this name */
  exists?: boolean;
  version?: string;
  /** When the first version was published (ms) */
  created?: number;
  weeklyDownloads?: number;
  /** Commands that run on install (npm pre/post/install scripts; a Python package with no wheel runs setup.py) */
  installScripts?: string[];
  license?: string;
  advisories?: { id: string; summary: string; severity?: string }[];
  /** Why the facts are incomplete, if they are */
  error?: string;
}

const ECOSYSTEM_OF: [RegExp, Ecosystem][] = [
  [/(^|\/)package\.json$/, 'npm'],
  [/(^|\/)(requirements[\w.-]*\.txt|pyproject\.toml|Pipfile)$/, 'PyPI'],
  [/(^|\/)Cargo\.toml$/, 'crates.io'],
  [/(^|\/)go\.mod$/, 'Go'],
  [/(^|\/)Gemfile$/, 'RubyGems'],
  [/(^|\/)composer\.json$/, 'Packagist'],
];

export const ecosystemOf = (path: string): Ecosystem | null => ECOSYSTEM_OF.find(([re]) => re.test(path))?.[1] ?? null;

/** PyPI treats -, _ and . as the same and ignores case */
export const normalizeName = (ecosystem: Ecosystem, name: string) => (ecosystem === 'PyPI' ? name.toLowerCase().replace(/[-_.]+/g, '-') : ecosystem === 'npm' || ecosystem === 'crates.io' ? name.toLowerCase() : name);

/** Dependencies the change adds to any manifest, with their ecosystem */
export function newDependencies(files: { path: string; kind: string; before: string; after: string }[]): NewDependency[] {
  const out: NewDependency[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const ecosystem = ecosystemOf(f.path);
    if (!ecosystem || f.kind === 'deleted') continue;
    const before = readDependencies(f.path, f.before);
    const after = readDependencies(f.path, f.after);
    for (const [name, spec] of Object.entries(after)) {
      if (name in before) continue;
      // Not packages: PHP and extensions in composer.json, local paths and workspaces in package.json
      if (ecosystem === 'Packagist' && (name === 'php' || name.startsWith('ext-'))) continue;
      if (typeof spec === 'string' && /^(file:|link:|workspace:|\.{0,2}\/)/.test(spec)) continue;
      const key = `${ecosystem}:${normalizeName(ecosystem, name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ecosystem, name, spec: typeof spec === 'string' ? spec : '', file: f.path });
    }
  }
  return out.slice(0, 30);
}

// The most-installed packages: what typosquats imitate. Short on purpose; a name one step from any of these is
// worth a second look.
const POPULAR: Partial<Record<Ecosystem, string[]>> = {
  npm: [
    'react', 'react-dom', 'preact', 'vue', 'svelte', 'angular', 'next', 'nuxt', 'express', 'koa', 'fastify', 'hono', 'lodash', 'lodash-es', 'underscore', 'axios', 'node-fetch', 'cross-fetch', 'got', 'request', 'chalk', 'commander', 'yargs', 'minimist', 'debug', 'dotenv', 'cross-env', 'uuid', 'nanoid', 'moment', 'dayjs', 'date-fns', 'luxon', 'zod', 'yup', 'joi', 'ajv', 'typescript', 'ts-node', 'tsx', 'esbuild', 'rsbuild', 'vite', 'webpack', 'rollup', 'parcel', 'babel-core', 'eslint', 'prettier', 'jest', 'vitest', 'mocha', 'chai', 'sinon', 'cypress', 'playwright', 'puppeteer', 'tailwindcss', 'postcss', 'autoprefixer', 'sass', 'less', 'styled-components', 'classnames', 'clsx', 'redux', 'react-redux', 'zustand', 'mobx', 'jotai', 'rxjs', 'immer', 'graphql', 'apollo-server', 'mongoose', 'mongodb', 'mysql', 'mysql2', 'pg', 'sqlite3', 'better-sqlite3', 'redis', 'ioredis', 'prisma', 'sequelize', 'typeorm', 'knex', 'drizzle-orm', 'socket.io', 'ws', 'cors', 'helmet', 'body-parser', 'cookie-parser', 'multer', 'morgan', 'winston', 'pino', 'bcrypt', 'bcryptjs', 'jsonwebtoken', 'passport', 'crypto-js', 'nodemailer', 'sharp', 'jimp', 'cheerio', 'jsdom', 'marked', 'markdown-it', 'highlight.js', 'semver', 'glob', 'rimraf', 'mkdirp', 'fs-extra', 'chokidar', 'execa', 'shelljs', 'inquirer', 'ora', 'colors', 'kleur', 'picocolors', 'yaml', 'js-yaml', 'ini', 'qs', 'query-string', 'validator', 'stripe', 'openai', 'electron', 'three', 'd3', 'chart.js', 'socket.io-client', 'event-stream', 'ua-parser-js', 'coa', 'rc', 'core-js', 'tslib', 'regenerator-runtime', 'web-vitals', 'framer-motion', 'react-router', 'react-router-dom', 'react-query', 'swr', 'formik', 'react-hook-form', 'ethers', 'web3', 'viem', 'wagmi', 'hardhat', 'color', 'jsdoc', 'tslint',
  ],
  PyPI: [
    'requests', 'urllib3', 'httpx', 'aiohttp', 'flask', 'django', 'fastapi', 'starlette', 'uvicorn', 'gunicorn', 'pydantic', 'sqlalchemy', 'alembic', 'psycopg2', 'psycopg2-binary', 'psycopg', 'pymysql', 'redis', 'celery', 'numpy', 'pandas', 'scipy', 'matplotlib', 'seaborn', 'scikit-learn', 'tensorflow', 'torch', 'torchvision', 'keras', 'transformers', 'datasets', 'tokenizers', 'openai', 'anthropic', 'langchain', 'tiktoken', 'pillow', 'opencv-python', 'beautifulsoup4', 'lxml', 'html5lib', 'selenium', 'playwright', 'scrapy', 'pytest', 'pytest-cov', 'coverage', 'tox', 'nox', 'black', 'ruff', 'flake8', 'pylint', 'mypy', 'isort', 'click', 'typer', 'rich', 'colorama', 'tqdm', 'pyyaml', 'toml', 'tomli', 'python-dotenv', 'python-dateutil', 'pytz', 'arrow', 'pendulum', 'six', 'attrs', 'setuptools', 'wheel', 'pip', 'virtualenv', 'boto3', 'botocore', 's3transfer', 'awscli', 'google-cloud-storage', 'jinja2', 'markupsafe', 'werkzeug', 'itsdangerous', 'cryptography', 'pyjwt', 'bcrypt', 'paramiko', 'pyopenssl', 'certifi', 'charset-normalizer', 'idna', 'chardet', 'jsonschema', 'protobuf', 'grpcio', 'websockets', 'docker', 'kubernetes', 'pymongo', 'motor', 'elasticsearch', 'networkx', 'sympy', 'jupyter', 'ipython', 'notebook', 'streamlit', 'gradio', 'dash', 'plotly', 'bokeh', 'pyarrow', 'polars', 'dask', 'xgboost', 'lightgbm', 'nltk', 'spacy', 'gensim', 'loguru', 'structlog', 'tenacity', 'marshmallow', 'peewee', 'tortoise-orm', 'asyncpg', 'aiofiles', 'pyserial', 'pygame', 'kivy', 'web3', 'eth-account', 'colorlog', 'termcolor', 'discord.py', 'python-telegram-bot', 'scapy', 'cattrs', 'boto',
  ],
  'crates.io': [
    'serde', 'serde_json', 'serde_derive', 'tokio', 'futures', 'async-trait', 'reqwest', 'hyper', 'axum', 'actix-web', 'warp', 'rocket', 'clap', 'structopt', 'anyhow', 'thiserror', 'log', 'env_logger', 'tracing', 'tracing-subscriber', 'rand', 'regex', 'lazy_static', 'once_cell', 'chrono', 'time', 'uuid', 'itertools', 'rayon', 'crossbeam', 'parking_lot', 'bytes', 'base64', 'hex', 'sha2', 'md5', 'ring', 'rustls', 'openssl', 'sqlx', 'diesel', 'rusqlite', 'redis', 'tonic', 'prost', 'syn', 'quote', 'proc-macro2', 'libc', 'bitflags', 'cfg-if', 'memchr', 'num', 'url', 'toml', 'serde_yaml', 'indexmap', 'smallvec', 'image', 'wasm-bindgen', 'web-sys', 'js-sys', 'tide',
  ],
};

const popularSets = new Map<Ecosystem, Map<string, string>>();
function popular(ecosystem: Ecosystem): Map<string, string> {
  let set = popularSets.get(ecosystem);
  if (!set) {
    set = new Map((POPULAR[ecosystem] ?? []).map((n) => [normalizeName(ecosystem, n), n]));
    popularSets.set(ecosystem, set);
  }
  return set;
}

/** Edit distance counting a swap of two neighbours as one edit (Damerau, optimal string alignment) */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const bare = (s: string) => s.replace(/[-_.]/g, '');
const lookalike = (s: string) => s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/[1|]/g, 'l').replace(/0/g, 'o').replace(/5/g, 's');

/** The popular package this name imitates, if it looks like one without being it */
export function typosquatOf(ecosystem: Ecosystem, name: string): string | null {
  const known = popular(ecosystem);
  if (!known.size) return null;
  const n = normalizeName(ecosystem, name);
  if (known.has(n)) return null;
  // A scope of its own (@acme/lodash) is a different package on purpose, not an imitation
  if (ecosystem === 'npm' && n.startsWith('@')) return null;
  for (const [p, original] of known) {
    if (bare(n) === bare(p) || lookalike(n) === lookalike(p)) return original;
    if (n.length < 4 || p.length < 4) continue;
    const d = editDistance(n, p, 2);
    if (d === 1 || (d === 2 && p.length >= 9)) return original;
  }
  return null;
}

const DAY = 86_400_000;
const STRONG_COPYLEFT = /\b(A?GPL|SSPL|EUPL|OSL|CC-BY-NC)/i;

/** The findings for one new dependency, from its name and (when the lookup worked) the registry's facts */
export function assessDependency(dep: Pick<NewDependency, 'ecosystem' | 'name'>, facts: PackageFacts | null, now = Date.now()): SupplyFinding[] {
  const out: SupplyFinding[] = [];
  const f = (kind: FindingKind, detail: string) => out.push({ ecosystem: dep.ecosystem, name: dep.name, kind, detail });
  const original = typosquatOf(dep.ecosystem, dep.name);
  if (original) f('typosquat', `${dep.name} looks like ${original}, a popular package: a typosquat installs someone else's code`);
  if (!facts) return out;
  if (facts.exists === false) {
    f('missing', `${dep.name} is not on ${dep.ecosystem}: a made-up name anyone could register and fill with code`);
    return out;
  }
  if (facts.installScripts?.length) f('install-script', `${dep.name} runs code when it is installed (${facts.installScripts.join(', ')})`);
  if (facts.created && now - facts.created < 30 * DAY) f('new', `${dep.name} was first published ${Math.max(0, Math.floor((now - facts.created) / DAY))} days ago`);
  if (facts.weeklyDownloads !== undefined && facts.weeklyDownloads < 200) f('unpopular', `${dep.name} has ${facts.weeklyDownloads} downloads a week`);
  if (facts.advisories?.length) {
    const top = facts.advisories.slice(0, 2).map((a) => `${a.id}${a.severity ? ` (${a.severity})` : ''}: ${a.summary}`).join('; ');
    f('advisory', `${dep.name}${facts.version ? ` ${facts.version}` : ''} has ${facts.advisories.length} known advisor${facts.advisories.length > 1 ? 'ies' : 'y'}: ${top}`);
  }
  const license = facts.license?.trim();
  if (!license || /^(UNLICENSED|NONE|UNKNOWN|SEE LICENSE IN)/i.test(license)) f('licence', `${dep.name} has no open-source licence on the registry${license ? ` (“${license}”)` : ''}`);
  else if (STRONG_COPYLEFT.test(license) && !/LGPL/i.test(license)) f('licence', `${dep.name} is ${license}: using it can oblige you to publish your own code`);
  return out;
}

/** Most serious first: a made-up or imitating name before an advisory, an advisory before a licence */
export function sortFindings(findings: SupplyFinding[]): SupplyFinding[] {
  const order: FindingKind[] = ['missing', 'typosquat', 'advisory', 'install-script', 'new', 'unpopular', 'licence'];
  return [...findings].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}
