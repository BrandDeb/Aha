'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { pipelineFiles } from '@/lib/pipelines/parse';
import type { GitHubRepoInfo, GitHubUserInfo } from '@/types';
import { useActions } from '../actions';
import { fetchJobLog, fetchRunJobs, fetchRuns, latestPerWorkflow, remoteFailureBrief, rerunFailed, type WorkflowRun } from '../pipelines-client';
import { useProposals } from '../proposals';
import { diffStatus, lineDelta } from '../project';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export function GitPanel({ user, onOpenPipelines }: { user: GitHubUserInfo | null; onOpenPipelines?: () => void }) {
  const { project, git, dispatch, saveSnapshot } = useWorkspace();
  const actions = useActions();
  const { notify } = useToast();
  const [repos, setRepos] = useState<GitHubRepoInfo[]>([]);
  const [repo, setRepo] = useState<string>(git ? `${git.owner}/${git.repo}` : '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState<string>(git?.branch ?? '');
  const [newBranch, setNewBranch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const changes = useMemo(() => (git ? diffStatus(git.base, project.files) : {}), [git, project.files]);
  const changedFiles = Object.keys(changes).sort();

  useEffect(() => {
    if (!user) return;
    api<{ repos: GitHubRepoInfo[] }>('/api/github/repos')
      .then((data) => setRepos(data.repos))
      .catch((error: Error) => notify({ kind: 'error', title: 'Could not load repositories', detail: error.message }));
  }, [user, notify]);

  const loadBranches = useCallback(async (fullName: string) => {
    if (!fullName) return;
    try {
      const data = await api<{ default: string; branches: Branch[] }>(`/api/github/repos/${fullName}/branches`);
      setBranches(data.branches);
      setBranch((current) => (current && data.branches.some((b) => b.name === current) ? current : data.default));
    } catch (error) {
      notify({ kind: 'error', title: 'Could not load branches', detail: (error as Error).message });
    }
  }, [notify]);

  useEffect(() => {
    // Fetching branches for the selected repository is external data, not derived state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (repo) void loadBranches(repo);
  }, [repo, loadBranches]);

  if (!user) {
    return (
      <div className="space-y-4 p-4">
        <h3 className="eyebrow">Git</h3>
        <p className="text-sm text-gray-400">Sign in with GitHub to pull a repository, review changes as diffs, manage branches and push commits.</p>
        <button onClick={actions.signIn} className="btn btn-primary w-full">
          Sign in with GitHub
        </button>
        <p className="text-xs text-gray-500">No GitHub account? You can create one for free on the same page.</p>
      </div>
    );
  }

  const [owner, name] = repo.split('/');

  const pull = async () => {
    if (!repo || !branch) return;
    if (git && changedFiles.length && !window.confirm(`Pulling replaces your workspace. ${changedFiles.length} uncommitted change(s) will be saved to History first. Continue?`)) return;
    setBusy('pull');
    try {
      const data = await api<{ sha: string; files: Record<string, string>; skipped: string[] }>(
        `/api/github/repos/${repo}/tree?branch=${encodeURIComponent(branch)}`
      );
      saveSnapshot('Before pull');
      const entry = ['src/main.ts', 'src/index.ts', 'main.ts', 'index.ts'].find((f) => f in data.files)
        ?? Object.keys(data.files).find((f) => /\.(?:ts|js)$/.test(f) && !f.endsWith('.d.ts'))
        ?? '';
      dispatch({
        type: 'replace',
        project: { name, files: data.files, folders: [], entry },
        git: { owner, repo: name, branch, headSha: data.sha, base: data.files },
      });
      notify({
        kind: 'success',
        title: `Pulled ${repo}@${branch}`,
        detail: `${Object.keys(data.files).length} files${data.skipped.length ? ` · ${data.skipped.length} binary or large files skipped` : ''}`,
      });
    } catch (error) {
      notify({ kind: 'error', title: 'Pull failed', detail: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const createBranch = async () => {
    const nameToCreate = newBranch.trim();
    if (!nameToCreate || !repo) return;
    setBusy('branch');
    try {
      await api(`/api/github/repos/${repo}/branches`, { method: 'POST', body: JSON.stringify({ name: nameToCreate, from: branch }) });
      await loadBranches(repo);
      setBranch(nameToCreate);
      setNewBranch('');
      if (git && git.owner === owner && git.repo === name) dispatch({ type: 'git', git: { ...git, branch: nameToCreate } });
      notify({ kind: 'success', title: `Created branch ${nameToCreate}`, detail: `from ${branch}` });
    } catch (error) {
      notify({ kind: 'error', title: 'Could not create branch', detail: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!git || !changedFiles.length || !message.trim()) return;
    setBusy('commit');
    const payload: Record<string, string | null> = {};
    for (const file of changedFiles) payload[file] = changes[file] === 'deleted' ? null : project.files[file];
    try {
      const result = await api<{ sha: string; html_url: string }>(`/api/github/repos/${git.owner}/${git.repo}/commit`, {
        method: 'POST',
        body: JSON.stringify({ branch: git.branch, message, changes: payload, expectedHead: git.headSha }),
      });
      dispatch({ type: 'git', git: { ...git, headSha: result.sha, base: { ...project.files } } });
      saveSnapshot(`Committed: ${message.slice(0, 40)}`);
      setMessage('');
      notify({
        kind: 'success',
        title: `Pushed ${changedFiles.length} file${changedFiles.length > 1 ? 's' : ''} to ${git.branch}`,
        detail: result.sha.slice(0, 7),
        action: { label: 'View on GitHub', run: () => window.open(result.html_url, '_blank', 'noopener') },
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const workflows = changedFiles.some((f) => f.startsWith('.github/workflows/'));
      notify({
        kind: 'error',
        title: status === 409 ? 'The branch has new commits' : 'Commit failed',
        detail:
          status === 409
            ? 'Someone pushed since your last pull. Pull to update, then commit again.'
            : workflows && (status === 403 || status === 404 || status === 422)
              ? 'GitHub needs the “workflow” permission to change files in .github/workflows/. Sign out (your avatar, top right) and sign in again to grant it, then commit again.'
              : (error as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  const linked = git && `${git.owner}/${git.repo}` === repo;

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-2.5" aria-labelledby="git-repo">
        <h3 id="git-repo" className="eyebrow">Repository</h3>
        <select value={repo} onChange={(e) => setRepo(e.target.value)} className="input" aria-label="Repository">
          <option value="">Choose a repository…</option>
          {repos.map((r) => (
            <option key={r.id} value={r.full_name}>{r.full_name}{r.private ? ' (private)' : ''}</option>
          ))}
        </select>
        {repo && (
          <div className="flex gap-2">
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="input" aria-label="Branch">
              {branches.map((b) => (
                <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>
              ))}
            </select>
            <button onClick={pull} disabled={!!busy || !branch} className="btn btn-secondary shrink-0">
              {busy === 'pull' ? 'Pulling…' : 'Pull'}
            </button>
          </div>
        )}
        {repo && (
          <div className="flex gap-2">
            <input
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createBranch()}
              placeholder="new-branch-name"
              aria-label="New branch name"
              className="input font-mono text-xs"
            />
            <button onClick={createBranch} disabled={!!busy || !newBranch.trim()} className="btn btn-ghost shrink-0">
              {busy === 'branch' ? 'Creating…' : 'Create branch'}
            </button>
          </div>
        )}
      </section>

      {git && (
        <section className="space-y-3" aria-labelledby="git-changes">
          <div className="flex items-center justify-between">
            <h3 id="git-changes" className="eyebrow">Changes · {changedFiles.length}</h3>
            <span className="font-mono text-[11px] text-gray-500">{git.branch} @ {git.headSha.slice(0, 7)}</span>
          </div>
          {!linked && repo && <p className="text-xs text-gray-500">The workspace is linked to {git.owner}/{git.repo}. Pull to switch.</p>}
          {changedFiles.length === 0 ? (
            <p className="text-sm text-gray-500">No changes since the last pull or commit.</p>
          ) : (
            <ul className="space-y-0.5">
              {changedFiles.map((file) => {
                const kind = changes[file];
                const delta = lineDelta(git.base[file] ?? '', project.files[file] ?? '');
                return (
                  <li key={file}>
                    <button
                      onClick={() => actions.showDiff({ title: `${file} — ${kind}`, path: file, original: git.base[file] ?? '', modified: project.files[file] ?? '' })}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs hover:bg-white/[0.05]"
                    >
                      <span className="w-3 text-gray-300" aria-label={kind}>{kind[0].toUpperCase()}</span>
                      <span className="min-w-0 flex-1 truncate text-gray-100">{file}</span>
                      <span className="text-gray-500">+{delta.added} −{delta.removed}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            placeholder="Commit message"
            aria-label="Commit message"
            className="input resize-none text-sm"
          />
          <button onClick={commit} disabled={!!busy || !changedFiles.length || !message.trim()} className="btn btn-primary w-full">
            {busy === 'commit' ? 'Pushing…' : `Commit & push to ${git.branch}`}
          </button>
          <p className="text-xs text-gray-500">Commits all changed files at once. If the branch moved since your pull, the push is refused so nothing is overwritten.</p>
        </section>
      )}

      {git && <RemotePipelines key={`${git.owner}/${git.repo}@${git.branch}`} owner={git.owner} repo={git.repo} branch={git.branch} head={git.headSha} onOpenPipelines={onOpenPipelines} />}
    </div>
  );
}

const RUN_ICON = (r: WorkflowRun) =>
  r.status !== 'completed' ? { icon: '◌', tone: 'text-accent', label: r.status.replace('_', ' ') } : r.conclusion === 'success' ? { icon: '✓', tone: 'text-accent', label: 'passed' } : r.conclusion === 'failure' || r.conclusion === 'timed_out' ? { icon: '✗', tone: 'text-danger', label: r.conclusion === 'failure' ? 'failed' : 'timed out' } : { icon: '–', tone: 'text-gray-500', label: r.conclusion ?? 'done' };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}

/** GitHub Actions on the linked branch: the latest run of each workflow, and the agent on failures */
function RemotePipelines({ owner, repo, branch, head, onOpenPipelines }: { owner: string; repo: string; branch: string; head: string; onOpenPipelines?: () => void }) {
  const { project } = useWorkspace();
  const proposals = useProposals();
  const { notify } = useToast();
  const [runs, setRuns] = useState<WorkflowRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const latest = useMemo(() => latestPerWorkflow(runs ?? []), [runs]);
  const active = latest.some((r) => r.status !== 'completed');

  useEffect(() => {
    let cancelled = false;
    fetchRuns(owner, repo, branch)
      .then((list) => {
        if (cancelled) return;
        setRuns(list);
        setError(null);
      })
      .catch((e: Error & { status?: number }) => {
        if (!cancelled) setError(e.status === 404 || e.status === 403 ? 'GitHub Actions isn’t available for this repository (or your sign-in can’t read it).' : e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, branch, head, tick]);
  // Poll while something runs, slowly otherwise
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), active ? 15_000 : 120_000);
    return () => clearInterval(timer);
  }, [active]);

  const fix = async (run: WorkflowRun) => {
    setBusy(run.id);
    try {
      const jobs = await fetchRunJobs(owner, repo, run.id);
      const job = jobs.find((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out') ?? jobs[0];
      if (!job) throw new Error('No jobs found for this run.');
      const log = await fetchJobLog(owner, repo, job.id).catch(() => '(The log could not be read.)');
      const local = pipelineFiles(project.files);
      const localFile = local.find((f) => run.path && f === run.path) ?? local.find((f) => f.startsWith('.github/')) ?? null;
      const id = proposals.ask(remoteFailureBrief(run, job, log, localFile), { label: `Fix CI: ${run.name} · ${job.name}`.slice(0, 100), approaches: 0, origin: 'debug' });
      if (!id) notify({ kind: 'info', title: 'The agent is busy', detail: 'Try again when its current task finishes.' });
    } catch (e) {
      notify({ kind: 'error', title: 'Could not read the failure', detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const rerun = async (run: WorkflowRun) => {
    setBusy(run.id);
    try {
      await rerunFailed(owner, repo, run.id);
      notify({ kind: 'success', title: 'Re-running the failed jobs', detail: run.name });
      setTimeout(() => setTick((t) => t + 1), 3000);
    } catch (e) {
      notify({ kind: 'error', title: 'Could not re-run', detail: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2.5" aria-labelledby="git-pipelines">
      <div className="flex items-center justify-between">
        <h3 id="git-pipelines" className="eyebrow">Pipelines · {branch}</h3>
        <button onClick={() => setTick((t) => t + 1)} className="btn btn-ghost btn-sm" aria-label="Refresh pipeline status">↻</button>
      </div>
      {error ? (
        <p className="text-xs text-gray-500">{error}</p>
      ) : runs === null ? (
        <p className="text-xs text-gray-500">Loading…</p>
      ) : latest.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">No pipeline runs on this branch yet.</p>
          {onOpenPipelines && <button onClick={onOpenPipelines} className="btn btn-secondary btn-sm w-full">Set up CI/CD</button>}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {latest.map((run) => {
            const s = RUN_ICON(run);
            const failed = run.status === 'completed' && (run.conclusion === 'failure' || run.conclusion === 'timed_out');
            return (
              <li key={run.id} className="space-y-1.5 rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-3 ${s.tone}`} aria-label={s.label}>{s.icon}</span>
                  <a href={run.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-gray-100 hover:text-accent" title="Open on GitHub">{run.name}</a>
                  <span className="font-mono text-[11px] text-gray-500">{run.headSha.slice(0, 7)} · {ago(run.updatedAt)}</span>
                </div>
                {failed && (
                  <div className="flex gap-2 pl-5">
                    <button onClick={() => void fix(run)} disabled={busy === run.id} className="btn btn-primary btn-sm">{busy === run.id ? 'Reading the log…' : 'Fix with agent'}</button>
                    <button onClick={() => void rerun(run)} disabled={busy === run.id} className="btn btn-ghost btn-sm">Re-run failed</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
