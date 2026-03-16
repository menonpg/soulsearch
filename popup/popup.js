// SoulSearch popup - main UI controller
import { SoulSearchAPI } from '../api/soul-api.js';

const $ = id => document.getElementById(id);

let pageContext = null;
let includeContext = true;
let api = null;
let chatHistory = [];

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
    } else {
      setStatus('error', 'No API key \u2014 open Settings');
    }

    var initCtx = await getPageText();
    if (initCtx) {
      pageContext = initCtx;
      $('ss-page-title').textContent = initCtx.title || initCtx.url || '-';
    } else {
      var initTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (initTabs[0]) $('ss-page-title').textContent = initTabs[0].title || '-';
    }

    const stored = await chrome.storage.local.get('chatHistory');
    if (stored.chatHistory && stored.chatHistory.length) {
      chatHistory = stored.chatHistory.slice(-20);
      chatHistory.forEach(function(m) { appendMessage(m.role, m.content); });
    }

    if (ok) {
      try {
        const memory = await api.getMemoryPeek();
        if (memory) {
          // memory panel stays hidden until user clicks brain button
          $('ss-memory-text').textContent = memory;
        }
      } catch (e) { /* optional */ }
    }
  } catch (e) {
    console.error('SoulSearch init error:', e);
    setStatus('error', 'Error: ' + e.message);
  }
}

$('ss-send-btn').addEventListener('click', sendMessage);
$('ss-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('ss-ctx-btn').addEventListener('click', function() {
  includeContext = !includeContext;
  $('ss-ctx-btn').style.opacity = includeContext ? '1' : '0.4';
});
$('ss-mem-btn').addEventListener('click', function() {
  var panel = $('ss-memory-peek');
  panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
});
$('ss-mem-close').addEventListener('click', function() {
  $('ss-memory-peek').style.display = 'none';
});
$('ss-mem-push').addEventListener('click', pushMemoryToGit);
$('ss-settings-link').addEventListener('click', function(e) {
  e.preventDefault();
  showSettings();
});
$('ss-agent-btn').addEventListener('click', function() {
  agentMode = !agentMode;
  var btn = $('ss-agent-btn');
  btn.style.outline = agentMode ? '2px solid #a78bfa' : 'none';
  $('ss-send-btn').textContent = agentMode ? 'Run' : 'Ask ->';
  if (agentMode) {
    appendMessage('system', 'Agent mode ON. Describe a task and I will act on this page.');
  }
});
$('cfg-cancel').addEventListener('click', function() {
  $('ss-settings').style.display = 'none';
});
$('cfg-save').addEventListener('click', saveSettings);


async function getPageText() {
  try {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return null;
    var tab = tabs[0];
    // Use executeScript for reliable text extraction on any page
    var results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function() {
        // innerText already skips script/style/hidden - DO NOT modify the DOM
        var text = (document.body.innerText || document.body.textContent || '').trim();
        var metaEl = document.querySelector('meta[name="description"]');
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
    // Fallback to content script message
    try {
      var tabs2 = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs2[0]) {
        var resp = await chrome.tabs.sendMessage(tabs2[0].id, { type: 'GET_CONTEXT' });
        if (resp && resp.context) return resp.context;
      }
    } catch(e2) { /* page not accessible */ }
  }
  return null;
}


async function pushMemoryToGit() {
  var btn = $('ss-mem-push');
  var orig = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;
  try {
    var config = await loadConfig();
    if (!config.gitOwner || !config.gitToken) {
      alert('Git not configured. Open Settings to add your repo.');
      return;
    }
    var stored = await chrome.storage.local.get(['soul_memory']);
    var memory = stored.soul_memory || '';
    var mod = await import('../api/git-storage.js');
    await mod.saveMemoryToGit({
      gitProvider: config.gitProvider,
      gitOwner: config.gitOwner,
      gitRepo: config.gitRepo,
      gitBranch: config.gitBranch || 'main',
      gitToken: config.gitToken
    }, null, memory);
    btn.textContent = 'done';
    setTimeout(function() { btn.textContent = orig; btn.disabled = false; }, 2000);
  } catch(e) {
    alert('Git push failed: ' + e.message);
    btn.textContent = orig;
    btn.disabled = false;
  }
}


async function runAgent(task) {
  var stepEl = appendMessage('loading', 'Starting agent...');
  try {
    var result = await api.agentRun(task, function(step) {
      if (step.type === 'thought' && step.text) {
        stepEl.textContent = step.text.slice(0, 100) + (step.text.length > 100 ? '...' : '');
      } else if (step.type === 'action') {
        var d = step.tool.replace(/_/g, ' ');
        if (step.input && step.input.element_id) d += ' [' + step.input.element_id + ']';
        if (step.input && step.input.text) d += ': "' + step.input.text.slice(0, 30) + '"';
        if (step.input && step.input.direction) d += ' ' + step.input.direction;
        stepEl.textContent = '> ' + d;
      }
    });
    stepEl.remove();
    appendMessage('assistant', result);
    chatHistory.push({ role: 'assistant', content: result });
    await chrome.storage.local.set({ chatHistory: chatHistory.slice(-40) });
  } catch(err) {
    stepEl.remove();
    appendMessage('assistant', 'Agent error: ' + err.message);
  }
}

async function sendMessage() {
  var input = $('ss-input');
  var query = input.value.trim();
  if (!query) return;

  input.value = '';
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });

  if (agentMode) { await runAgent(query); return; }

  var loadingEl = appendMessage('loading', '\u23f3 Thinking\u2026');

  try {
    // Get page text via executeScript - works on any page regardless of load state
    var freshContext = await getPageText();
    if (freshContext && freshContext.text && freshContext.text.length > 100) {
      pageContext = freshContext;
    }

    var context = null;
    if (includeContext && pageContext && pageContext.text) {
      context = '[Page URL: ' + (pageContext.url || '') + ']\n' +
                '[Page Title: ' + pageContext.title + ']\n\n' +
                pageContext.text.slice(0, 5000);
    }

    var response = await api.ask(query, context, chatHistory.slice(-10));
    loadingEl.remove();
    appendMessage('assistant', response.answer);
    chatHistory.push({ role: 'assistant', content: response.answer });

    if (response.memory_used) {
      // memory panel stays hidden until user clicks brain button
      $('ss-memory-text').textContent = response.memory_used;
    }

    await chrome.storage.local.set({ chatHistory: chatHistory.slice(-40) });
  } catch (err) {
    loadingEl.remove();
    appendMessage('assistant', '\u26a0\ufe0f Error: ' + err.message);
  }
}

function renderMarkdown(raw) {
  var s = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  s = s.replace(/[*][*](.+?)[*][*]/g, '<strong>$1</strong>');
  s = s.replace(/[*](.+?)[*]/g, '<em>$1</em>');
  s = s.replace(/^[#]{3} (.+)$/gm, '<h4 style="margin:6px 0 2px;color:#a78bfa">$1</h4>');
  s = s.replace(/^[#]{2} (.+)$/gm, '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[#] (.+)$/gm,    '<h3 style="margin:8px 0 3px;color:#818cf8">$1</h3>');
  s = s.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/^[0-9]+[.] (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul> - use String.fromCharCode to avoid \n in source
  var LF = String.fromCharCode(10);
  var sections = s.split(LF + LF);
  s = sections.map(function(sec) {
    var trimmed = sec.trim();
    if (trimmed.indexOf('<li>') === 0) {
      return '<ul style="margin:4px 0;padding-left:18px">' +
        trimmed.split(LF).join('') + '</ul>';
    }
    return sec;
  }).join('<br><br>');

  s = s.split(LF).join('<br>');
  // Remove <br> immediately before/after block elements to prevent double spacing
  s = s.replace(/<br>(<(ul|ol|h3|h4|\/ul|\/ol))/g, '<$2');
  s = s.replace(/(<\/(ul|ol|h3|h4)>)<br>/g, '</$2>');
  s = s.replace(/(<br>){3,}/g, '<br><br>');
  return s;
}

function appendMessage(role, content) {
  var chat = $('ss-chat');
  var el = document.createElement('div');
  el.className = 'ss-message ss-message--' + role;
  if (role === 'assistant') {
    el.innerHTML = renderMarkdown(content);
    // Add save-to-memory button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'ss-save-btn';
    saveBtn.textContent = 'save to memory';
    saveBtn.title = 'Append this to your memory';
    saveBtn.addEventListener('click', function() {
      saveToMemory(content, window.location.href || '');
      saveBtn.textContent = 'saved';
      saveBtn.disabled = true;
    });
    el.appendChild(saveBtn);
  } else {
    el.textContent = content;
  }
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

async function saveToMemory(text, source) {
  var stored = await chrome.storage.local.get(['soul_memory']);
  var existing = stored.soul_memory || '';
  var date = new Date().toISOString().slice(0, 10);
  var entry = '\n\n[' + date + (source ? ' | ' + source.slice(0, 60) : '') + ']\n' + text.slice(0, 800);
  var updated = existing + entry;
  await chrome.storage.local.set({ soul_memory: updated });
  // Update memory panel if open
  var memText = $('ss-memory-text');
  if (memText) memText.textContent = updated;
}

function setStatus(state, text) {
  $('ss-dot').className = 'ss-dot ' + state;
  $('ss-status-text').textContent = text;
}

async function loadConfig() {
  var defaults = {
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
    var local = await chrome.storage.local.get(defaults);
    try {
      var sync = await chrome.storage.sync.get(['llmKey', 'provider']);
      if (sync.llmKey && !local.llmKey) {
        local.llmKey = sync.llmKey;
        await chrome.storage.local.set({ llmKey: sync.llmKey });
      }
    } catch (e) { /* sync unavailable */ }
    return Object.assign({}, defaults, local);
  } catch (e) {
    return defaults;
  }
}

async function showSettings() {
  var config = await loadConfig();
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
  var gitOwner    = $('cfg-git-owner').value.trim();
  var gitRepo     = $('cfg-git-repo').value.trim();
  var gitBranch   = $('cfg-git-branch').value.trim() || 'main';
  var gitToken    = $('cfg-git-token').value.trim();
  var gitProvider = $('cfg-git-provider').value;

  await chrome.storage.local.set({
    provider:    $('cfg-provider').value,
    llmKey:      $('cfg-llm-key').value.trim(),
    model:       $('cfg-model').value.trim() || 'claude-3-haiku-20240307',
    soul:        $('cfg-soul').value.trim(),
    gitProvider: gitProvider,
    gitOwner:    gitOwner,
    gitRepo:     gitRepo,
    gitBranch:   gitBranch,
    gitToken:    gitToken,
  });

  if (gitOwner && gitRepo && gitToken) {
    var statusEl = $('cfg-git-status');
    statusEl.className = 'ss-git-status info';
    statusEl.textContent = '\u23f3 Syncing memory from Git\u2026';
    try {
      var mod = await import('../api/git-storage.js');
      await mod.loadMemoryFromGit({
        gitProvider: gitProvider,
        gitOwner: gitOwner,
        gitRepo: gitRepo,
        gitBranch: gitBranch,
        gitToken: gitToken
      });
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
