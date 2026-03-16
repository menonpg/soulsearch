// SoulSearch Git Storage
// Reads/writes SOUL.md and MEMORY.md from any compatible Git host.
// Results cached in chrome.storage.local - no network call on every query.

function apiBase(provider, owner, repo) {
  switch (provider) {
    case 'gitlab':
      return `https://gitlab.com/api/v4/projects/${encodeURIComponent(owner + '/' + repo)}/repository`;
    case 'gitea':
      // User supplies host in owner field as "host:owner" e.g. "git.mypi.local:prahlad"
      const [host, actualOwner] = owner.includes(':') ? owner.split(':') : ['localhost:3000', owner];
      return `https://${host}/api/v1/repos/${actualOwner}/${repo}/contents`;
    default: // github
      return `https://api.github.com/repos/${owner}/${repo}/contents`;
  }
}

function authHeaders(provider, token) {
  if (provider === 'gitlab') return { 'PRIVATE-TOKEN': token };
  if (provider === 'gitea')  return { 'Authorization': `token ${token}` };
  return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json' };
}

async function getFile(provider, owner, repo, branch, token, path) {
  const base = apiBase(provider, owner, repo);
  const url  = provider === 'gitlab'
    ? `${base}/files/${encodeURIComponent(path)}?ref=${branch}`
    : `${base}/${path}?ref=${branch}`;

  const r = await fetch(url, { headers: authHeaders(provider, token) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Git ${r.status} fetching ${path}`);
  const data = await r.json();
  // GitHub/Gitea: base64 content field. GitLab: content field
  const raw = data.content || data.content;
  return atob(raw.replace(/\s/g, ''));
}

async function putFile(provider, owner, repo, branch, token, path, content, existingSha = null) {
  const base = apiBase(provider, owner, repo);
  const url  = provider === 'gitlab'
    ? `${base}/files/${encodeURIComponent(path)}`
    : `${base}/${path}`;

  const encoded = btoa(unescape(encodeURIComponent(content)));
  const body = {
    message: `memory: update ${path} via SoulSearch`,
    content: encoded,
    branch,
    ...(existingSha ? { sha: existingSha } : {})
  };

  const method = (provider === 'gitlab') ? (existingSha ? 'PUT' : 'POST') : 'PUT';
  const r = await fetch(url, {
    method,
    headers: { ...authHeaders(provider, token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(`Git write ${r.status}: ${JSON.stringify(err)}`);
  }
  return r.json();
}

async function getFileSha(provider, owner, repo, branch, token, path) {
  const base = apiBase(provider, owner, repo);
  const url  = `${base}/${path}?ref=${branch}`;
  try {
    const r = await fetch(url, { headers: authHeaders(provider, token) });
    if (!r.ok) return null;
    const data = await r.json();
    return data.sha || null;
  } catch { return null; }
}

// -- Public API ----------------------------------------------------------------

export async function loadMemoryFromGit({ gitProvider, gitOwner, gitRepo, gitBranch, gitToken }) {
  const soul   = await getFile(gitProvider, gitOwner, gitRepo, gitBranch, gitToken, 'SOUL.md');
  const memory = await getFile(gitProvider, gitOwner, gitRepo, gitBranch, gitToken, 'MEMORY.md');

  const update = {};
  if (soul)   update.soul_soul   = soul;
  if (memory) update.soul_memory = memory;
  if (Object.keys(update).length) {
    await chrome.storage.local.set(update);
  }

  return { soul, memory };
}

export async function saveMemoryToGit({ gitProvider, gitOwner, gitRepo, gitBranch, gitToken }, newEntry, fullContent) {
  const sha = await getFileSha(gitProvider, gitOwner, gitRepo, gitBranch, gitToken, 'MEMORY.md');
  let content;
  if (fullContent !== undefined && fullContent !== null) {
    // Push full local memory as-is
    content = fullContent;
  } else if (newEntry) {
    // Append a new entry to existing file
    const existing = await getFile(gitProvider, gitOwner, gitRepo, gitBranch, gitToken, 'MEMORY.md') || '';
    content = existing + '\n\n---\n' + newEntry;
  } else {
    return; // nothing to save
  }
  await putFile(gitProvider, gitOwner, gitRepo, gitBranch, gitToken, 'MEMORY.md', content, sha);
  await chrome.storage.local.set({ soul_memory: content });
}
