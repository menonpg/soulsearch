// SoulSearch popup — main UI controller
import { SoulSearchAPI } from '../api/soul-api.js';

const $ = id => document.getElementById(id);

let pageContext = null;
let includeContext = true;
let api = null;
let chatHistory = [];

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const config = await loadConfig();
    api = new SoulSearchAPI(config);

    const ok = await api.ping();
    // Show soul identity source in status
    if (ok) {
      const check = await chrome.storage.local.get(['soul_soul', 'soul_memory']);
      const hasSoul = !!(check.soul_soul && check.soul_soul.length > 10);
      const hasMem  = !!(check.soul_memory && check.soul_memory.length > 10);
      const tag = hasSoul ? ' · identity loaded' : ' · no identity (open Settings)';
      setStatus('connected', 'Memory active' + (hasMem ? ' · mem ✓' : '') + tag);
    } else {
      setStatus('error', 'No API key — open Settings');
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      $('ss-page-title').textContent = tab.title || tab.url || '—';
      try {
        const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' });
        if (resp?.context) pageContext = resp.context;
      } catch (e) { /* content script not on this page */ }
    }

    const stored = await chrome.storage.local.get('chatHistory');
    if (stored.chatHistory?.length) {
      chatHistory = stored.chatHistory.slice(-20);
      chatHistory.forEach(m => appendMessage(m.role, m.content));
    }

    if (ok) {
      try {
        const memory = await api.getMemoryPeek();
        if (memory) {
          $('ss-memory-peek').style.display = 'block';
          $('ss-memory-text').textContent = memory;
        }
      } catch (e) { /* optional */ }
    }
  } catch (e) {
    console.error('SoulSearch init error:', e);
    setStatus('error', 'Error: ' + e.message);
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

$('ss-send-btn').addEventListener('click', sendMessage);
$('ss-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('ss-ctx-btn').addEventListener('click', () => {
  includeContext = !includeContext;
  $('ss-ctx-btn').style.opacity = includeContext ? '1' : '0.4';
});
$('ss-mem-btn').addEventListener('click', () => {
  const peek = $('ss-memory-peek');
  peek.style.display = peek.style.display === 'none' ? 'block' : 'none';
});
$('ss-settings-link').addEventListener('click', e => {
  e.preventDefault();
  showSettings();
});
$('cfg-cancel').addEventListener('click', () => {
  $('ss-settings').style.display = 'none';
});
$('cfg-save').addEventListener('click', saveSettings);

// ── Send message ──────────────────────────────────────────────────────────────

async function sendMessage() {
  const input = $('ss-input');
  const query = input.value.trim();
  if (!query) return;

  input.value = '';
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });

  const loadingEl = appendMessage('loading', '⏳ Thinking…');

  try {
    const context = includeContext && pageContext
      ? '[Page: ' + pageContext.title + ']\n' + (pageContext.text || '').slice(0, 3000)
      : null;

    const response = await api.ask(query, context, chatHistory.slice(-10));
    loadingEl.remove();
    appendMessage('assistant', response.answer);
    chatHistory.push({ role: 'assistant', content: response.answer });

    if (response.memory_used) {
      $('ss-memory-peek').style.display = 'block';
      $('ss-memory-text').textContent = response.memory_used;
    }

    await chrome.storage.local.set({ chatHistory: chatHistory.slice(-40) });
  } catch (err) {
    loadingEl.remove();
    appendMessage('assistant', '\u26a0\ufe0f Error: ' + err.message);
  }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderMarkdown(raw) {
  let s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s.replace(/[*][*](.+?)[*][*]/g, '<strong>$1</strong>');
  s = s.replace(/[*](.+?)[*]/g, '<em>$1</em>');
  s = s.replace(/^[#]{3} (.+)$/gm, '<h4 style="margin:6px 0 2px;color:#a78bfa">$1</h4>');
  s = s.replace(/^[#]{2} (.+)$/gm, '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[#] (.+)$/gm,    '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^[*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>.*<[/]li>
?)+/g, function(m) {
    return '<ul style="margin:4px 0;padding-left:18px">' + m + '</ul>';
  });
  s = s.replace(/^\d+[.] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/

/g, '<br><br>');
  s = s.replace(/
/g, '<br>');
  return s;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function appendMessage(role, content) {
  const chat = $('ss-chat');
  const el = document.createElement('div');
  el.className = 'ss-message ss-message--' + role;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(content);
  } else {
    el.textContent = content;
  }
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function setStatus(state, text) {
  $('ss-dot').className = 'ss-dot ' + state;
  $('ss-status-text').textContent = text;
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadConfig() {
  const defaults = {
    provider: 'anthropic',
    llmKey: '',
    model: 'claude-3-haiku-20240307',
    soul: '',
    gitProvider: 'github',
    gitOwner: '',
    gitRepo: '',
    gitBranch: 'main',
    gitToken: '',
  };
  try {
    const local = await chrome.storage.local.get(defaults);
    // Migrate from old sync storage
    try {
      const sync = await chrome.storage.sync.get(['llmKey', 'provider']);
      if (sync.llmKey && !local.llmKey) {
        local.llmKey = sync.llmKey;
        await chrome.storage.local.set({ llmKey: sync.llmKey });
      }
    } catch (e) { /* sync unavailable */ }
    return { ...defaults, ...local };
  } catch (e) {
    return defaults;
  }
}

async function showSettings() {
  const config = await loadConfig();
  $('cfg-provider').value     = config.provider;
  $('cfg-llm-key').value      = config.llmKey;
  $('cfg-model').value        = config.model;
  $('cfg-git-provider').value = config.gitProvider;
  $('cfg-git-owner').value    = config.gitOwner;
  $('cfg-git-repo').value     = config.gitRepo;
  $('cfg-git-branch').value   = config.gitBranch || 'main';
  $('cfg-git-token').value    = config.gitToken;
  $('cfg-soul').value         = config.soul;
  $('ss-settings').style.display = 'block';
}

async function saveSettings() {
  const gitOwner    = $('cfg-git-owner').value.trim();
  const gitRepo     = $('cfg-git-repo').value.trim();
  const gitBranch   = $('cfg-git-branch').value.trim() || 'main';
  const gitToken    = $('cfg-git-token').value.trim();
  const gitProvider = $('cfg-git-provider').value;

  await chrome.storage.local.set({
    provider:    $('cfg-provider').value,
    llmKey:      $('cfg-llm-key').value.trim(),
    model:       $('cfg-model').value.trim() || 'claude-3-haiku-20240307',
    soul:        $('cfg-soul').value.trim(),
    gitProvider, gitOwner, gitRepo, gitBranch, gitToken,
  });

  if (gitOwner && gitRepo && gitToken) {
    const statusEl = $('cfg-git-status');
    statusEl.className = 'ss-git-status info';
    statusEl.textContent = '\u23f3 Syncing memory from Git\u2026';
    try {
      const { loadMemoryFromGit } = await import('../api/git-storage.js');
      await loadMemoryFromGit({ gitProvider, gitOwner, gitRepo, gitBranch, gitToken });
      statusEl.className = 'ss-git-status ok';
      statusEl.textContent = '\u2705 Memory synced from Git';
    } catch (e) {
      statusEl.className = 'ss-git-status err';
      statusEl.textContent = '\u274c Git sync failed: ' + e.message;
    }
  }

  $('ss-settings').style.display = 'none';
  init();
}

init();
