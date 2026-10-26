/**
 * CI/CD files for a project: a GitHub Actions workflow or a GitLab CI file that
 * sets up the project's toolchain, installs dependencies and runs its checks,
 * plus an optional deploy (GitHub/GitLab Pages, a container image, Vercel,
 * Netlify, Fly.io, or release binaries). The result is an ordinary file in the
 * project: you can edit it, and the studio runs it locally as it is.
 */

import yaml from 'js-yaml';
import { ACTIONS, type Stack } from './stack.ts';

export type Provider = 'github' | 'gitlab';
export type DeployTarget = 'none' | 'pages' | 'docker' | 'vercel' | 'netlify' | 'fly' | 'release';

export const PROVIDERS: { id: Provider; name: string; path: string }[] = [
  { id: 'github', name: 'GitHub Actions', path: '.github/workflows/ci.yml' },
  { id: 'gitlab', name: 'GitLab CI', path: '.gitlab-ci.yml' },
];

export const DEPLOY_TARGETS: { id: DeployTarget; name: string; detail: string }[] = [
  { id: 'none', name: 'No deploy', detail: 'Checks only: lint, typecheck, test and build on every push and pull request' },
  { id: 'pages', name: 'Pages', detail: 'Publish the static build to GitHub Pages or GitLab Pages' },
  { id: 'docker', name: 'Container image', detail: 'Build the Dockerfile and push the image to the GitHub or GitLab container registry' },
  { id: 'vercel', name: 'Vercel', detail: 'Build and deploy to production with the Vercel CLI' },
  { id: 'netlify', name: 'Netlify', detail: 'Deploy the static build with the Netlify CLI' },
  { id: 'fly', name: 'Fly.io', detail: 'Deploy with flyctl, using your fly.toml' },
  { id: 'release', name: 'Release binaries', detail: 'On a v* tag, build for Linux, macOS and Windows and attach the binaries to a GitHub release' },
];

/** Secrets each deploy needs, by name; set them in the repository's settings */
export const SECRETS: Partial<Record<DeployTarget, string[]>> = {
  vercel: ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID'],
  netlify: ['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID'],
  fly: ['FLY_API_TOKEN'],
};

/** Whether a deploy target fits this project, and why not when it doesn't */
export function deployAvailability(target: DeployTarget, stack: Stack, files: Record<string, string>, provider: Provider): { ok: true } | { ok: false; reason: string } {
  switch (target) {
    case 'none':
      return { ok: true };
    case 'pages':
    case 'netlify':
      return stack.staticDir ? { ok: true } : { ok: false, reason: 'Needs a static site (a Vite or Astro app with a build script, or plain HTML).' };
    case 'docker':
      return 'Dockerfile' in files ? { ok: true } : { ok: false, reason: 'Needs a Dockerfile. Ask the agent to write one, then come back.' };
    case 'vercel':
      return 'package.json' in files || stack.id === 'static' ? { ok: true } : { ok: false, reason: 'Needs a JavaScript project or a static site.' };
    case 'fly':
      return 'fly.toml' in files ? { ok: true } : { ok: false, reason: 'Needs fly.toml: run `fly launch --no-deploy` once to create it.' };
    case 'release':
      if (provider !== 'github') return { ok: false, reason: 'Release binaries are set up for GitHub releases only.' };
      return stack.binary ? { ok: true } : { ok: false, reason: 'Needs a project that builds a single binary (Go, Rust or scriptc).' };
  }
}

export interface GenerateOptions {
  provider: Provider;
  deploy?: DeployTarget;
  /** The branch that deploys and that pushes run on (default main) */
  branch?: string;
  /** For release binaries: the file name (default the project name) */
  name?: string;
}

export interface Generated {
  path: string;
  content: string;
  /** Secrets to add in the repository settings */
  secrets: string[];
  notes: string[];
}

const HEADER = (stacks: Stack[], provider: Provider) =>
  `# ${provider === 'github' ? 'GitHub Actions' : 'GitLab CI'} for ${stacks.map((s) => s.name).join(' + ')}, set up by NanoCLI Studio.\n` +
  `# It is yours to edit: the studio reads this file as it is and runs it locally from the Pipelines tab.\n`;

const dump = (doc: unknown) => yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' });

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';

type GhStep = Record<string, unknown>;

function ghCheckSteps(stack: Stack, only?: Set<string>): GhStep[] {
  const steps: GhStep[] = [{ uses: ACTIONS.checkout }];
  for (const s of stack.setup) steps.push({ name: s.name, uses: s.uses, ...(s.with ? { with: s.with } : {}) });
  for (const command of stack.install) steps.push({ name: 'Install dependencies', run: command });
  for (const check of stack.checks) if (!only || only.has(check.id)) steps.push({ name: check.label, run: check.run });
  return steps;
}

function github(stacks: Stack[], options: GenerateOptions): Generated {
  const branch = options.branch || 'main';
  const deploy = options.deploy ?? 'none';
  const main = stacks[0];
  const notes = stacks.flatMap((s) => s.notes);
  const secrets = [...(SECRETS[deploy] ?? [])];
  const onMain = `github.event_name == 'push' && github.ref == 'refs/heads/${branch}'`;

  const jobs: Record<string, unknown> = {};
  const checkIds: string[] = [];
  for (const stack of stacks) {
    const id = stacks.length > 1 ? `check-${stack.id}` : 'check';
    checkIds.push(id);
    jobs[id] = { name: stack.name, 'runs-on': 'ubuntu-latest', 'timeout-minutes': 20, steps: ghCheckSteps(stack) };
  }
  const build = new Set(['build']);

  if (deploy === 'pages') {
    jobs.deploy = {
      name: 'Deploy to GitHub Pages',
      needs: checkIds,
      if: onMain,
      'runs-on': 'ubuntu-latest',
      permissions: { contents: 'read', pages: 'write', 'id-token': 'write' },
      environment: { name: 'github-pages', url: '${{ steps.deployment.outputs.page_url }}' },
      steps: [...ghCheckSteps(main, build), { uses: ACTIONS.configurePages }, { uses: ACTIONS.uploadPages, with: { path: main.staticDir } }, { id: 'deployment', uses: ACTIONS.deployPages }],
    };
    notes.push('In the repository settings, under Pages, set the source to “GitHub Actions”.');
  } else if (deploy === 'docker') {
    jobs.image = {
      name: 'Build and push the container image',
      needs: checkIds,
      if: onMain,
      'runs-on': 'ubuntu-latest',
      permissions: { contents: 'read', packages: 'write' },
      steps: [
        { uses: ACTIONS.checkout },
        { name: 'Image name', run: 'echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"' },
        { uses: ACTIONS.dockerLogin, with: { registry: 'ghcr.io', username: '${{ github.actor }}', password: '${{ secrets.GITHUB_TOKEN }}' } },
        { uses: ACTIONS.dockerBuildx },
        { uses: ACTIONS.dockerBuild, with: { context: '.', push: true, tags: '${{ env.IMAGE }}:latest,${{ env.IMAGE }}:${{ github.sha }}', 'cache-from': 'type=gha', 'cache-to': 'type=gha,mode=max' } },
      ],
    };
    notes.push('The image is pushed to ghcr.io/<owner>/<repo>; no secret needed beyond the built-in GITHUB_TOKEN.');
  } else if (deploy === 'vercel') {
    const token = '--token=${{ secrets.VERCEL_TOKEN }}';
    jobs.deploy = {
      name: 'Deploy to Vercel',
      needs: checkIds,
      if: onMain,
      'runs-on': 'ubuntu-latest',
      env: { VERCEL_ORG_ID: '${{ secrets.VERCEL_ORG_ID }}', VERCEL_PROJECT_ID: '${{ secrets.VERCEL_PROJECT_ID }}' },
      steps: [
        { uses: ACTIONS.checkout },
        { name: 'Set up Node.js', uses: ACTIONS.node, with: { 'node-version': '24' } },
        { name: 'Install the Vercel CLI', run: 'npm install --global vercel@latest' },
        { name: 'Pull project settings', run: `vercel pull --yes --environment=production ${token}` },
        { name: 'Build', run: `vercel build --prod ${token}` },
        { name: 'Deploy', run: `vercel deploy --prebuilt --prod ${token}` },
      ],
    };
    notes.push('Find VERCEL_ORG_ID and VERCEL_PROJECT_ID in .vercel/project.json after running `vercel link` once.');
  } else if (deploy === 'netlify') {
    jobs.deploy = {
      name: 'Deploy to Netlify',
      needs: checkIds,
      if: onMain,
      'runs-on': 'ubuntu-latest',
      steps: [...ghCheckSteps(main, build), { name: 'Deploy', run: `npx --yes netlify-cli deploy --dir=${main.staticDir} --prod`, env: { NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}', NETLIFY_SITE_ID: '${{ secrets.NETLIFY_SITE_ID }}' } }],
    };
  } else if (deploy === 'fly') {
    jobs.deploy = {
      name: 'Deploy to Fly.io',
      needs: checkIds,
      if: onMain,
      'runs-on': 'ubuntu-latest',
      concurrency: { group: 'fly-deploy', 'cancel-in-progress': false },
      steps: [{ uses: ACTIONS.checkout }, { uses: ACTIONS.flyctl }, { name: 'Deploy', run: 'flyctl deploy --remote-only', env: { FLY_API_TOKEN: '${{ secrets.FLY_API_TOKEN }}' } }],
    };
  } else if (deploy === 'release' && main.binary) {
    const name = safeName(options.name ?? 'app');
    const ext = "${{ runner.os == 'Windows' && '.exe' || '' }}";
    jobs.release = {
      name: 'Release binaries (${{ matrix.os }})',
      needs: checkIds,
      if: "startsWith(github.ref, 'refs/tags/v')",
      strategy: { matrix: { os: ['ubuntu-latest', 'macos-latest', 'windows-latest'] } },
      'runs-on': '${{ matrix.os }}',
      permissions: { contents: 'write' },
      steps: [
        ...ghCheckSteps(main, new Set()),
        { name: 'Build the binary', run: main.binary.build(name, ext) },
        { name: 'Package', shell: 'bash', run: `mkdir -p dist && cp "${main.binary.output(name, ext)}" "dist/${name}-$(echo "$RUNNER_OS" | tr '[:upper:]' '[:lower:]')-$(uname -m)${ext}"` },
        { uses: ACTIONS.release, with: { files: 'dist/*', generate_release_notes: true } },
      ],
    };
    notes.push('Push a tag such as v1.0.0 (git tag v1.0.0 && git push --tags) to publish a release.');
  }

  const doc = {
    name: 'CI',
    on: {
      push: { branches: [branch], ...(deploy === 'release' ? { tags: ['v*'] } : {}) },
      pull_request: null,
      workflow_dispatch: null,
    },
    permissions: { contents: 'read' },
    concurrency: { group: '${{ github.workflow }}-${{ github.ref }}', 'cancel-in-progress': deploy === 'none' || deploy === 'release' },
    jobs,
  };
  // `pull_request:` with no value and a bare `on:` are the idiomatic spellings; js-yaml writes `null` and `"on"`
  const content = HEADER(stacks, 'github') + '\n' + dump(doc).replace(/: null$/gm, ':').replace(/^"on":/m, 'on:');
  return { path: '.github/workflows/ci.yml', content, secrets, notes };
}

function gitlab(stacks: Stack[], options: GenerateOptions): Generated {
  const deploy = options.deploy ?? 'none';
  const main = stacks[0];
  const notes = stacks.flatMap((s) => s.notes);
  const secrets = [...(SECRETS[deploy] ?? [])];
  const onDefault = [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }];
  const doc: Record<string, unknown> = { stages: deploy === 'none' ? ['check'] : ['check', 'deploy'] };
  const scriptFor = (stack: Stack, only?: Set<string>) => [...(stack.gitlabSetup ?? []), ...stack.install, ...stack.checks.filter((c) => !only || only.has(c.id)).map((c) => c.run)];

  for (const stack of stacks) {
    const id = stacks.length > 1 ? `check:${stack.id}` : 'check';
    const script = scriptFor(stack);
    doc[id] = { stage: 'check', image: stack.image, script: script.length ? script : ['echo "Nothing to check yet"'] };
  }
  const build = new Set(['build']);
  if (deploy === 'pages') {
    const dir = main.staticDir ?? 'dist';
    const move = dir === 'public' ? [] : dir === '.' ? ['mkdir -p .public && cp -r $(ls -A | grep -v -e "^.public$" -e "^.git$") .public && mv .public public'] : [`rm -rf public && mv ${dir} public`];
    doc.pages = { stage: 'deploy', image: main.image, script: [...scriptFor(main, build), ...move], artifacts: { paths: ['public'] }, rules: onDefault };
  } else if (deploy === 'docker') {
    doc.image = {
      stage: 'deploy',
      image: 'docker:27',
      services: ['docker:27-dind'],
      variables: { DOCKER_TLS_CERTDIR: '/certs' },
      script: [
        'echo "$CI_REGISTRY_PASSWORD" | docker login -u "$CI_REGISTRY_USER" --password-stdin "$CI_REGISTRY"',
        'docker build -t "$CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA" -t "$CI_REGISTRY_IMAGE:latest" .',
        'docker push --all-tags "$CI_REGISTRY_IMAGE"',
      ],
      rules: onDefault,
    };
  } else if (deploy === 'vercel') {
    doc.deploy = {
      stage: 'deploy',
      image: 'node:24',
      script: ['npm install --global vercel@latest', 'vercel pull --yes --environment=production --token="$VERCEL_TOKEN"', 'vercel build --prod --token="$VERCEL_TOKEN"', 'vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"'],
      rules: onDefault,
    };
  } else if (deploy === 'netlify') {
    doc.deploy = { stage: 'deploy', image: main.image, script: [...scriptFor(main, build), `npx --yes netlify-cli deploy --dir=${main.staticDir} --prod`], rules: onDefault };
  } else if (deploy === 'fly') {
    doc.deploy = { stage: 'deploy', image: 'flyio/flyctl:latest', script: ['flyctl deploy --remote-only'], rules: onDefault };
  }
  if (secrets.length) notes.push('Add the secrets as masked CI/CD variables (Settings → CI/CD → Variables).');
  return { path: '.gitlab-ci.yml', content: HEADER(stacks, 'gitlab') + '\n' + dump(doc), secrets, notes };
}

export function generatePipeline(stacks: Stack[], files: Record<string, string>, options: GenerateOptions): Generated | { error: string } {
  if (!stacks.length) return { error: 'The studio could not tell how this project is built. Add a package.json, pyproject.toml, go.mod, Cargo.toml or similar first.' };
  const deploy = options.deploy ?? 'none';
  const available = deployAvailability(deploy, stacks[0], files, options.provider);
  if (!available.ok) return { error: available.reason };
  return options.provider === 'github' ? github(stacks, options) : gitlab(stacks, options);
}
