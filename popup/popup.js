// SoulSearch popup -- v2 with sessions, memory panel, agent mode
import { SoulSearchAPI } from '../api/soul-api.js';

const $ = id => document.getElementById(id);

let api = null;
let chatHistory = [];
let pageContext = null;
let includeContext = true;
let agentMode = false;

const SESSION_KEY = 'ss_sessions';
const CURRENT_KEY = 'ss_current';

// ============================================================
// INIT
// ============================================================

async function init() {
  try {
    const config = await loadConfig();
    api = new SoulSearchAPI(config);

    const ok = await api.ping();
    if (ok) {
      const check = await chrome.storage.local.get(['soul_soul', 'soul_memory']);
      const hasSoul = !!(check.soul_soul && check.soul_soul.length > 10);
      const hasMem  = !!(check.soul_memory && check.soul_memory.length > 10);
      const tag = hasSoul ? ' \u00b7 identity loaded' : ' \u00b7 no identity (Settings)';
      setStatus('connected', 'Memory active' + (hasMem ? ' \u00b7 mem \u2713' : '') + tag);
      if (hasMem) $('ss-memory-global-text').textContent = check.soul_memory;
    } else {
      setStatus('error', 'No API key -- open Settings');
    }

    // Get page context
    const ctx = await getPageText();
    if (ctx) {
      pageContext = ctx;
      $('ss-page-title').textContent = ctx.title || ctx.url || '--';
    } else {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) $('ss-page-title').textContent = tabs[0].title || '--';
    }

    // Load sessions
    const { sessions, currentId } = await loadSessions();
    renderSessionSelect(sessions, currentId);
    const sess = sessions[currentId];
    if (sess && sess.history && sess.history.length) {
      chatHistory = sess.history.slice(-20);
      const chat = $('ss-chat');
      chat.innerHTML = '<div class="ss-message ss-message--system">Ask me anything about this page, or start a research thread. I remember everything.</div>';
      chatHistory.forEach(m => appendMessage(m.role, m.content));
    }

    // Handle pending context-menu action
    const pending = await chrome.storage.local.get('pendingAction');
    if (pending.pendingAction && (Date.now() - pending.pendingAction.timestamp < 5000)) {
      const action = pending.pendingAction;
      await chrome.storage.local.remove('pendingAction');
      if (action.type === 'soulsearch-save' && action.text) {
        await saveToMemory(action.text, action.url);
        appendMessage('system', 'Saved to memory: "' + action.text.slice(0, 80) + '..."');
      } else if (action.type === 'soulsearch-ask' && action.text) {
        $('ss-input').value = action.text;
        sendMessage();
      } else if (action.type === 'soulsearch-page') {
        $('ss-input').value = 'Summarize this page for me.';
        sendMessage();
      }
    }
  } catch (e) {
    console.error('SoulSearch init error:', e);
    setStatus('error', 'Error: ' + e.message);
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

$('ss-send-btn').addEventListener('click', sendMessage);
$('ss-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('ss-ctx-btn').addEventListener('click', function() {
  includeContext = !includeContext;
  $('ss-ctx-btn').style.opacity = includeContext ? '1' : '0.4';
});
$('ss-mem-btn').addEventListener('click', function() {
  const panel = $('ss-memory-peek');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});
$('ss-agent-btn').addEventListener('click', function() {
  agentMode = !agentMode;
  $('ss-agent-btn').style.outline = agentMode ? '2px solid #a78bfa' : 'none';
  $('ss-agent-btn').style.background = agentMode ? '#3b1f6b' : '';
  $('ss-send-btn').textContent = agentMode ? 'Run Agent' : 'Ask ->';
  $('ss-send-btn').style.background = agentMode ? '#7c3aed' : '';
  $('ss-input').placeholder = agentMode
    ? 'Describe a task to perform on this page...'
    : 'Ask about this page...';
  setStatus(agentMode ? 'connected' : 'connected',
    agentMode ? 'AGENT MODE -- I will act on this page' : 'Memory active');
  if (agentMode) appendMessage('system', 'Agent mode ON. I will use tools to act on this page. Type a task and click Run Agent.');
  else appendMessage('system', 'Agent mode OFF.');
});
$('ss-settings-link').addEventListener('click', function(e) {
  e.preventDefault();
  showSettings();
});

// Memory panel buttons
$('ss-mem-close').addEventListener('click', function() {
  $('ss-memory-peek').style.display = 'none';
});
$('ss-mem-push').addEventListener('click', pushMemoryToGit);
$('ss-mem-reset').addEventListener('click', showVersionPicker);

// Version picker
$('ss-ver-close').addEventListener('click', function() {
  $('ss-ver-modal').style.display = 'none';
});

// Memory tab switching
$('ss-mem-tab-session').addEventListener('click', function() {
  $('ss-mem-tab-session').classList.add('ss-mem-tab--active');
  $('ss-mem-tab-global').classList.remove('ss-mem-tab--active');
  $('ss-memory-session-text').style.display = 'block';
  $('ss-memory-global-text').style.display = 'none';
  updateSessionMemoryDisplay();
});

$('ss-mem-tab-global').addEventListener('click', function() {
  $('ss-mem-tab-global').classList.add('ss-mem-tab--active');
  $('ss-mem-tab-session').classList.remove('ss-mem-tab--active');
  $('ss-memory-global-text').style.display = 'block';
  $('ss-memory-session-text').style.display = 'none';
});

// Settings
$('cfg-cancel').addEventListener('click', function() {
  $('ss-settings').style.display = 'none';
});
$('cfg-save').addEventListener('click', saveSettings);

// Session bar
$('ss-session-select').addEventListener('change', function() { switchSession(this.value); });
$('ss-session-new').addEventListener('click', newSession);
$('ss-session-del').addEventListener('click', deleteSession);
$('ss-chat-clear').addEventListener('click', async function() {
  if (!confirm('Clear this conversation?')) return;
  chatHistory = [];
  await saveCurrentHistory();
  $('ss-chat').innerHTML = '<div class="ss-message ss-message--system">Conversation cleared.</div>';
});

// ============================================================
// MESSAGING
// ============================================================

async function sendMessage() {
  const input = $('ss-input');
  const query = input.value.trim();
  if (!query) return;
  input.value = '';
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });
  await saveCurrentHistory();  // Save immediately so question isn't lost if popup closes

  if (agentMode) { await runAgent(query); return; }

  const loadingEl = appendMessage('loading', '\u23f3 Thinking\u2026');
  try {
    // Refresh page context on each send
    try {
      const fresh = await getPageText();
      if (fresh && fresh.text && fresh.text.length > ((pageContext && pageContext.text) ? pageContext.text.length : 0)) {
        pageContext = fresh;
      }
    } catch(e) { /* keep existing */ }

    let context = null;
    if (includeContext && pageContext && pageContext.text) {
      context = '[Page URL: ' + (pageContext.url || '') + ']\n[Page Title: ' + pageContext.title + ']\n\n' + pageContext.text.slice(0, 5000);
    }

    // Get current session ID for session memory
    const s = await loadSessions();
    const currentSessionId = s.currentId;

    const response = await api.ask(query, context, chatHistory.slice(-10), currentSessionId);
    loadingEl.remove();
    appendMessage('assistant', response.answer);
    chatHistory.push({ role: 'assistant', content: response.answer });
    if (response.memory_used) $('ss-memory-global-text').textContent = response.memory_used;
    await saveCurrentHistory();
  } catch (err) {
    loadingEl.remove();
    appendMessage('assistant', '\u26a0\ufe0f Error: ' + err.message);
  }
}

async function runAgent(task) {
  appendMessage('system', '[Agent] Starting...');
  var debugLog = [];
  function dbg(msg) {
    debugLog.push(msg);
    appendMessage('system', '[Agent] ' + msg);
  }
  try {
    const result = await api.agentRun(task, function(step) {
      if (step.type === 'thought' && step.text) dbg(step.text);
      else if (step.type === 'action') {
        var d = step.tool.replace(/_/g, ' ');
        if (step.input && step.input.element_id) d += ' [' + step.input.element_id + ']';
        if (step.input && step.input.text) d += ': "' + step.input.text.slice(0, 40) + '"';
        dbg('> ' + d);
      } else if (step.type === 'done') {
        dbg('done: ' + (step.text || '').slice(0, 60));
      }
    });
    appendMessage('assistant', result);
    chatHistory.push({ role: 'assistant', content: result });
    await saveCurrentHistory();
  } catch(err) {
    appendMessage('assistant', 'Agent error: ' + err.message);
  }
}

// ============================================================
// PAGE TEXT EXTRACTION
// ============================================================

async function getPageText() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: function() {
        const text = (document.body.innerText || document.body.textContent || '').trim();
        const metaEl = document.querySelector('meta[name="description"]');
        return {
          url: location.href,
          title: document.title,
          text: text.replace(/[ \t]{3,}/g, ' ').replace(/\n{4,}/g, '\n\n').slice(0, 8000),
          metaDesc: metaEl ? metaEl.content : null
        };
      }
    });
    if (results && results[0] && results[0].result) return results[0].result;
  } catch(e) {
    // Fallback to content script
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        const resp = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_CONTEXT' });
        if (resp && resp.context) return resp.context;
      }
    } catch(e2) { /* not accessible */ }
  }
  return null;
}

// ============================================================
// MEMORY
// ============================================================

async function saveToMemory(text, source) {
  const stored = await chrome.storage.local.get(['soul_memory']);
  const existing = stored.soul_memory || '';
  const date = new Date().toISOString().slice(0, 10);
  const entry = '\n\n[' + date + (source ? ' | ' + source.slice(0, 60) : '') + ']\n' + text.slice(0, 800);
  const updated = existing + entry;
  await chrome.storage.local.set({ soul_memory: updated });
  $('ss-memory-global-text').textContent = updated;
}

async function updateSessionMemoryDisplay() {
  const s = await loadSessions();
  const session = s.sessions[s.currentId];
  const sessionMem = session?.sessionMemory || '';
  $('ss-memory-session-text').textContent = sessionMem || '(No session memories yet. Click "💾 Session" on any response to save.)';
}

async function saveToSessionMemory(text, source) {
  const s = await loadSessions();
  const sessionId = s.currentId;
  const sessions = s.sessions;
  
  if (!sessions[sessionId]) return;
  
  const date = new Date().toISOString().slice(0, 10);
  const entry = '[' + date + (source ? ' | ' + source.slice(0, 40) : '') + '] ' + text.slice(0, 500) + '\n';
  
  sessions[sessionId].sessionMemory = (sessions[sessionId].sessionMemory || '') + entry;
  await chrome.storage.local.set({ [SESSION_KEY]: sessions });
  
  // Update display if panel is open
  if ($('ss-memory-peek').style.display !== 'none') {
    $('ss-memory-session-text').textContent = sessions[sessionId].sessionMemory;
  }
  
  return sessions[sessionId].sessionMemory;
}

async function pushMemoryToGit() {
  const btn = $('ss-mem-push');
  const statusEl = $('ss-mem-status');
  const orig = btn.textContent;
  btn.textContent = '...'; btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Pushing...';
  try {
    const config = await loadConfig();
    if (!config.gitOwner || !config.gitToken) {
      if (statusEl) statusEl.textContent = 'Git not configured - open Settings';
      btn.textContent = orig; btn.disabled = false; return;
    }
    const stored = await chrome.storage.local.get(['soul_memory']);
    const memory = stored.soul_memory || '';
    const mod = await import('../api/git-storage.js');
    await mod.saveMemoryToGit({
      gitProvider: config.gitProvider, gitOwner: config.gitOwner,
      gitRepo: config.gitRepo, gitBranch: config.gitBranch || 'main', gitToken: config.gitToken
    }, null, memory);
    btn.textContent = orig; btn.disabled = false;
    if (statusEl) statusEl.textContent = 'Pushed to ' + config.gitOwner + '/' + config.gitRepo;
  } catch(e) {
    btn.textContent = orig; btn.disabled = false;
    if (statusEl) statusEl.textContent = 'Push failed: ' + e.message;
    console.error('Push failed:', e);
  }
}

async function showVersionPicker() {
  const config = await loadConfig();
  if (!config.gitOwner || !config.gitToken) { alert('Git not configured.'); return; }
  const modal = $('ss-ver-modal');
  const list = $('ss-ver-list');
  modal.style.display = 'flex';
  list.textContent = 'Loading...';
  try {
    const url = 'https://api.github.com/repos/' + config.gitOwner + '/' + config.gitRepo +
                '/commits?path=MEMORY.md&per_page=10&sha=' + (config.gitBranch || 'main');
    const r = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + config.gitToken, 'Accept': 'application/vnd.github+json' }
    });
    const commits = await r.json();
    list.innerHTML = '';
    commits.forEach(function(c) {
      const item = document.createElement('div');
      item.className = 'ss-ver-item';
      const date = new Date(c.commit.author.date).toLocaleString();
      item.innerHTML = '<span class="ss-ver-sha">' + c.sha.slice(0,7) + '</span>' +
                       '<span class="ss-ver-date">' + date + '</span><br>' +
                       c.commit.message.slice(0, 60);
      item.addEventListener('click', async function() {
        if (!confirm('Restore MEMORY.md to this commit?')) return;
        list.textContent = 'Restoring...';
        try {
          const fr = await fetch('https://api.github.com/repos/' + config.gitOwner + '/' + config.gitRepo + '/contents/MEMORY.md?ref=' + c.sha,
            { headers: { 'Authorization': 'Bearer ' + config.gitToken } });
          const fd = await fr.json();
          const bytes = new Uint8Array(atob(fd.content.replace(/\s/g, '')).split('').map(function(ch) { return ch.charCodeAt(0); }));
          const text = new TextDecoder('utf-8').decode(bytes);
          await chrome.storage.local.set({ soul_memory: text });
          $('ss-memory-global-text').textContent = text;
          modal.style.display = 'none';
        } catch(e) { list.textContent = 'Error: ' + e.message; }
      });
      list.appendChild(item);
    });
  } catch(e) { list.textContent = 'Error: ' + e.message; }
}

// ============================================================
// SESSIONS
// ============================================================

async function loadSessions() {
  const s = await chrome.storage.local.get([SESSION_KEY, CURRENT_KEY]);
  let sessions = s[SESSION_KEY] || {};
  let currentId = s[CURRENT_KEY] || null;
  if (Object.keys(sessions).length === 0) {
    const defId = 'session_' + Date.now();
    sessions[defId] = { id: defId, name: 'Session 1', history: [], sessionMemory: '', created: Date.now() };
    currentId = defId;
    await chrome.storage.local.set({ [SESSION_KEY]: sessions, [CURRENT_KEY]: currentId });
  }
  if (!currentId || !sessions[currentId]) {
    currentId = Object.keys(sessions)[0];
    await chrome.storage.local.set({ [CURRENT_KEY]: currentId });
  }
  return { sessions, currentId };
}

async function saveCurrentHistory() {
  const s = await loadSessions();
  const sessions = s.sessions;
  sessions[s.currentId].history = chatHistory.slice(-40);
  await chrome.storage.local.set({ [SESSION_KEY]: sessions });
}

async function switchSession(id) {
  const s = await loadSessions();
  if (!s.sessions[id]) return;
  await saveCurrentHistory();
  await chrome.storage.local.set({ [CURRENT_KEY]: id });
  chatHistory = (s.sessions[id].history || []).slice(-20);
  const chat = $('ss-chat');
  chat.innerHTML = '<div class="ss-message ss-message--system">Ask me anything about this page, or start a research thread. I remember everything.</div>';
  chatHistory.forEach(m => appendMessage(m.role, m.content));
  renderSessionSelect(s.sessions, id);
}

async function newSession() {
  const s = await loadSessions();
  await saveCurrentHistory();
  const id = 'session_' + Date.now();
  const name = 'Session ' + (Object.keys(s.sessions).length + 1);
  s.sessions[id] = { id, name, history: [], sessionMemory: '', created: Date.now() };
  await chrome.storage.local.set({ [SESSION_KEY]: s.sessions, [CURRENT_KEY]: id });
  chatHistory = [];
  $('ss-chat').innerHTML = '<div class="ss-message ss-message--system">New session. Ask me anything.</div>';
  renderSessionSelect(s.sessions, id);
}

async function deleteSession() {
  const s = await loadSessions();
  const keys = Object.keys(s.sessions);
  if (keys.length <= 1) { alert('Cannot delete the last session.'); return; }
  if (!confirm('Delete this session?')) return;
  delete s.sessions[s.currentId];
  const newCurrent = Object.keys(s.sessions)[0];
  await chrome.storage.local.set({ [SESSION_KEY]: s.sessions, [CURRENT_KEY]: newCurrent });
  await switchSession(newCurrent);
}

function renderSessionSelect(sessions, currentId) {
  const sel = $('ss-session-select');
  sel.innerHTML = '';
  Object.values(sessions).sort((a, b) => a.created - b.created).forEach(function(sess) {
    const opt = document.createElement('option');
    opt.value = sess.id;
    const memCount = sess.sessionMemory ? sess.sessionMemory.split('\n').filter(l => l.trim()).length : 0;
    opt.textContent = sess.name + ' (' + (sess.history?.length || 0) + ')' + (memCount ? ' 🧠' + memCount : '');
    opt.selected = sess.id === currentId;
    sel.appendChild(opt);
  });
}

// ============================================================
// MARKDOWN + UI HELPERS
// ============================================================

function renderMarkdown(raw) {
  let s = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/[*][*](.+?)[*][*]/g, '<strong>$1</strong>');
  s = s.replace(/[*](.+?)[*]/g, '<em>$1</em>');
  s = s.replace(/^[#]{3} (.+)$/gm, '<h4 style="margin:6px 0 2px;color:#a78bfa">$1</h4>');
  s = s.replace(/^[#]{2} (.+)$/gm, '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[#] (.+)$/gm,    '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^[0-9]+[.] (.+)$/gm, '<li>$1</li>');
  const LF = String.fromCharCode(10);
  const sections = s.split(LF + LF);
  s = sections.map(function(sec) {
    const trimmed = sec.trim();
    if (trimmed.indexOf('<li>') === 0) {
      return '<ul style="margin:4px 0;padding-left:18px">' + trimmed.split(LF).join('') + '</ul>';
    }
    return sec;
  }).join('<br><br>');
  s = s.split(LF).join('<br>');
  s = s.replace(/<br>(<[/]?(ul|ol|h3|h4))/g, '<$2');
  s = s.replace(/(<[/](ul|ol|h3|h4)>)<br>/g, '</$2>');
  s = s.replace(/(<br>){3,}/g, '<br><br>');
  return s;
}

function appendMessage(role, content) {
  const chat = $('ss-chat');
  const el = document.createElement('div');
  el.className = 'ss-message ss-message--' + role;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(content);
    
    // Create save buttons container
    const saveBtns = document.createElement('div');
    saveBtns.className = 'ss-save-btns';
    
    // Session memory button
    const sessionBtn = document.createElement('button');
    sessionBtn.className = 'ss-save-btn ss-save-btn--session';
    sessionBtn.textContent = '💾 Session';
    sessionBtn.title = 'Save to this session\'s memory';
    sessionBtn.addEventListener('click', async function() {
      await saveToSessionMemory(content, pageContext ? pageContext.url : '');
      sessionBtn.textContent = '✓ Session';
      sessionBtn.disabled = true;
    });
    
    // Global memory button
    const globalBtn = document.createElement('button');
    globalBtn.className = 'ss-save-btn ss-save-btn--global';
    globalBtn.textContent = '🌐 Global';
    globalBtn.title = 'Save to global memory (Git-backed)';
    globalBtn.addEventListener('click', function() {
      saveToMemory(content, pageContext ? pageContext.url : '');
      globalBtn.textContent = '✓ Global';
      globalBtn.disabled = true;
    });
    
    saveBtns.appendChild(sessionBtn);
    saveBtns.appendChild(globalBtn);
    el.appendChild(saveBtns);
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

// ============================================================
// SETTINGS
// ============================================================

async function loadConfig() {
  const defaults = {
    provider: 'anthropic', llmKey: '', model: 'claude-3-haiku-20240307',
    agentModel: '',
    agentProvider: '',
    agentApiKey: '',
    agentOllamaUrl: '',
    soul: '', gitProvider: 'github', gitOwner: '', gitRepo: '',
    gitBranch: 'main', gitToken: '', ollamaUrl: 'http://localhost:11434',
    memoryStrategy: 'truncate', braveApiKey: '',
  };
  try {
    const local = await chrome.storage.local.get(defaults);
    try {
      const sync = await chrome.storage.sync.get(['llmKey', 'provider']);
      if (sync.llmKey && !local.llmKey) {
        local.llmKey = sync.llmKey;
        await chrome.storage.local.set({ llmKey: sync.llmKey });
      }
    } catch(e) { /* sync unavailable */ }
    return Object.assign({}, defaults, local);
  } catch(e) { return defaults; }
}

function updateProviderUI(provider) {
  const isOllama = provider === 'ollama';
  const urlLabel = $('cfg-ollama-url-label');
  const keyHint = $('cfg-key-hint');
  if (urlLabel) urlLabel.style.display = isOllama ? 'block' : 'none';
  if (keyHint) keyHint.textContent = isOllama ? '(not needed for Ollama)' : '';
}

function updateAgentProviderUI(agentProvider) {
  const isOllama = agentProvider === 'ollama';
  const needsKey = agentProvider === 'anthropic' || agentProvider === 'openai';
  $('cfg-agent-key-label').style.display = needsKey ? 'block' : 'none';
  $('cfg-agent-key').style.display = needsKey ? 'block' : 'none';
  $('cfg-agent-url-label').style.display = isOllama ? 'block' : 'none';
  $('cfg-agent-ollama-url').style.display = isOllama ? 'block' : 'none';
}

async function showSettings() {
  const config = await loadConfig();
  $('cfg-provider').value     = config.provider;
  $('cfg-llm-key').value      = config.llmKey;
  $('cfg-model').value        = config.model;
  $('cfg-ollama-url').value   = config.ollamaUrl || 'http://localhost:11434';
  $('cfg-memory-strategy').value = config.memoryStrategy || 'truncate';
  $('cfg-brave-key').value    = config.braveApiKey || '';
  $('cfg-agent-model').value  = config.agentModel || '';
  $('cfg-agent-provider').value = config.agentProvider || '';
  $('cfg-agent-key').value = config.agentApiKey || '';
  $('cfg-agent-ollama-url').value = config.agentOllamaUrl || '';
  updateAgentProviderUI(config.agentProvider);
  $('cfg-git-provider').value = config.gitProvider;
  $('cfg-git-owner').value    = config.gitOwner;
  $('cfg-git-repo').value     = config.gitRepo;
  $('cfg-git-branch').value   = config.gitBranch || 'main';
  $('cfg-git-token').value    = config.gitToken;
  $('cfg-soul').value         = config.soul;
  updateProviderUI(config.provider);
  $('ss-settings').style.display = 'block';
  $('cfg-provider').onchange = function() { updateProviderUI(this.value); };
  $('cfg-agent-provider').onchange = function() { updateAgentProviderUI(this.value); };
}

async function saveSettings() {
  const gitOwner = $('cfg-git-owner').value.trim();
  const gitRepo = $('cfg-git-repo').value.trim();
  const gitBranch = $('cfg-git-branch').value.trim() || 'main';
  const gitToken = $('cfg-git-token').value.trim();
  const gitProvider = $('cfg-git-provider').value;
  const provider = $('cfg-provider').value;
  const ollamaUrl = $('cfg-ollama-url').value.trim() || 'http://localhost:11434';
  const memoryStrategy = $('cfg-memory-strategy').value;
  const braveApiKey = $('cfg-brave-key').value.trim();

  await chrome.storage.local.set({
    provider, llmKey: $('cfg-llm-key').value.trim(),
    model: $('cfg-model').value.trim() || (provider === 'ollama' ? 'llama3.2' : 'claude-3-haiku-20240307'),
    agentModel: $('cfg-agent-model').value.trim(),
    agentProvider: $('cfg-agent-provider').value,
    agentApiKey: $('cfg-agent-key').value.trim(),
    agentOllamaUrl: $('cfg-agent-ollama-url').value.trim(),
    soul: $('cfg-soul').value.trim(),
    ollamaUrl, memoryStrategy, braveApiKey,
    gitProvider, gitOwner, gitRepo, gitBranch, gitToken,
  });

  if (gitOwner && gitRepo && gitToken) {
    const statusEl = $('cfg-git-status');
    statusEl.textContent = '\u23f3 Syncing...';
    try {
      const mod = await import('../api/git-storage.js');
      await mod.loadMemoryFromGit({ gitProvider, gitOwner, gitRepo, gitBranch, gitToken });
      statusEl.textContent = '\u2705 Memory synced';
    } catch(e) {
      statusEl.textContent = '\u274c Sync failed: ' + e.message;
    }
  }
  $('ss-settings').style.display = 'none';
  init();
}

init();
