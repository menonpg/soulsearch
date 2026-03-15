/**
 * SoulSearch GitStorage — store SOUL.md and MEMORY.md in any private Git repo
 *
 * Supports:
 *   - GitHub  (api.github.com)
 *   - GitLab  (gitlab.com or self-hosted)
 *   - Gitea   (any self-hosted Gitea/Forgejo instance)
 *   - Generic (any Git hosting with a compatible Contents API)
 *
 * Credentials NEVER leave your device. The Git token is stored only in
 * chrome.storage.local (not chrome.storage.sync = not sent to Google).
 * SOUL.md and MEMORY.md live entirely in your private Git repo.
 */

export class GitStorage {
  constructor({ provider, host, owner, repo, branch, token }) {
    this.provider = provider || 'github'; // 'github' | 'gitlab' | 'gitea'
    this.host = host || 'api.github.com';
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
    this.token = token; // stored ONLY in chrome.storage.local, never in Git
  }

  // ── Low-level API ────────────────────────────────────────────────────────

  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.provider === 'github' || this.provider === 'gitea') {
      h['Authorization'] = `Bearer ${this.token}`;
    } else if (this.provider === 'gitlab') {
      h['PRIVATE-TOKEN'] = this.token;
    }
    return h;
  }

  _url(path) {
    if (this.provider === 'github') {
      return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    } else if (this.provider === 'gitlab') {
      const encoded = encodeURIComponent(path);
      return `https://${this.host}/api/v4/projects/${encodeURIComponent(this.owner + '/' + this.repo)}/repository/files/${encoded}?ref=${this.branch}`;
    } else if (this.provider === 'gitea') {
      return `https://${this.host}/api/v1/repos/${this.owner}/${this.repo}/contents/${path}?ref=${this.branch}`;
    }
  }

  _writeUrl(path) {
    if (this.provider === 'gitlab') {
      const encoded = encodeURIComponent(path);
      return `https://${this.host}/api/v4/projects/${encodeURIComponent(this.owner + '/' + this.repo)}/repository/files/${encoded}`;
    }
    return this._url(path).split('?')[0]; // same as read for GitHub/Gitea
  }

  // ── Read a file ──────────────────────────────────────────────────────────

  async readFile(path) {
    const r = await fetch(this._url(path), {
      headers: this._headers(),
      signal: AbortSignal.timeout(10000)
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Git read failed ${r.status}: ${path}`);

    const data = await r.json();
    // GitHub/Gitea: base64-encoded content field
    // GitLab: content field also base64
    const content = data.content || data.encoding === 'base64' ? data.content : null;
    if (!content) return null;
    return atob(content.replace(/\n/g, ''));
  }

  // ── Write/update a file ──────────────────────────────────────────────────

  async writeFile(path, content, message) {
    // Need current SHA for updates (GitHub/Gitea)
    let sha = null;
    if (this.provider !== 'gitlab') {
      const existing = await this._getFileMeta(path);
      sha = existing?.sha || null;
    }

    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body = {
      message: message || `soulsearch: update ${path}`,
      content: encoded,
      branch: this.branch,
      ...(sha ? { sha } : {})
    };

    // GitLab uses a different method for create vs update
    const method = (this.provider === 'gitlab' && !sha) ? 'POST' : 'PUT';

    const r = await fetch(this._writeUrl(path), {
      method,
      headers: this._headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Git write failed ${r.status}: ${err.slice(0, 100)}`);
    }
    return r.json();
  }

  async _getFileMeta(path) {
    try {
      const r = await fetch(this._url(path), {
        headers: this._headers(),
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) return null;
      const data = await r.json();
      return { sha: data.sha };
    } catch { return null; }
  }

  // ── Health check ─────────────────────────────────────────────────────────

  async ping() {
    try {
      let url;
      if (this.provider === 'github') {
        url = `https://api.github.com/repos/${this.owner}/${this.repo}`;
      } else if (this.provider === 'gitlab') {
        url = `https://${this.host}/api/v4/projects/${encodeURIComponent(this.owner + '/' + this.repo)}`;
      } else {
        url = `https://${this.host}/api/v1/repos/${this.owner}/${this.repo}`;
      }
      const r = await fetch(url, { headers: this._headers(), signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }

  // ── High-level: soul.py file operations ─────────────────────────────────

  async loadSoul() {
    return this.readFile('SOUL.md');
  }

  async loadMemory() {
    return this.readFile('MEMORY.md');
  }

  async loadTodaysNotes(date) {
    const d = date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return this.readFile(`memory/${d}.md`).catch(() => null);
  }

  async appendMemory(newContent) {
    const existing = await this.loadMemory() || '# Memory\n\n';
    const updated = existing.trimEnd() + '\n\n' + newContent;
    return this.writeFile('MEMORY.md', updated, 'soulsearch: memory update');
  }

  async appendDailyNote(content) {
    const date = new Date().toISOString().slice(0, 10);
    const path = `memory/${date}.md`;
    const existing = await this.readFile(path).catch(() => null);
    const header = existing ? '' : `# Notes — ${date}\n\n`;
    const timestamp = new Date().toLocaleTimeString();
    const updated = (existing || '') + `${header}## ${timestamp}\n\n${content}\n\n`;
    return this.writeFile(path, updated, `soulsearch: daily note ${date}`);
  }

  // ── Load config from Git (settings.json) ─────────────────────────────────
  // Note: LLM API keys are NEVER stored in Git.
  // Only non-sensitive config (provider preference, UI settings) lives here.

  async loadSettings() {
    try {
      const raw = await this.readFile('soulsearch-settings.json');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  async saveSettings(settings) {
    // Strip any API keys before writing to Git
    const safe = { ...settings };
    delete safe.llmKey;
    delete safe.apiKey;
    delete safe.gitToken;
    return this.writeFile(
      'soulsearch-settings.json',
      JSON.stringify(safe, null, 2),
      'soulsearch: update settings'
    );
  }
}

// ── Factory: build GitStorage from chrome.storage.local ──────────────────────

export async function loadGitStorage() {
  const cfg = await chrome.storage.local.get([
    'gitProvider', 'gitHost', 'gitOwner', 'gitRepo', 'gitBranch', 'gitToken'
  ]);
  if (!cfg.gitOwner || !cfg.gitRepo || !cfg.gitToken) return null;
  return new GitStorage({
    provider: cfg.gitProvider || 'github',
    host: cfg.gitHost || 'api.github.com',
    owner: cfg.gitOwner,
    repo: cfg.gitRepo,
    branch: cfg.gitBranch || 'main',
    token: cfg.gitToken // stays local, never synced
  });
}
