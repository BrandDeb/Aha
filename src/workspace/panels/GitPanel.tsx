'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GitHubRepoInfo, GitHubUserInfo } from '@/types';
import { useActions } from '../actions';
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

export function GitPanel({ user }: { user: GitHubUserInfo | null }) {
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
        <button
          // Full-page navigation: the OAuth flow is a server redirect, not a client route
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => window.location.assign('/api/github/auth')}
          className="btn btn-primary w-full"
        >
          Sign in with GitHub
        </button>
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
      notify({
        kind: 'error',
        title: status === 409 ? 'The branch has new commits' : 'Commit failed',
        detail: status === 409 ? 'Someone pushed since your last pull. Pull to update, then commit again.' : (error as Error).message,
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
    </div>
  );
}
