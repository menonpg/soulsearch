import { SoulSearchAPI } from '../api/soul-api.js';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'ss_sessions';
const CURRENT_KEY = 'ss_current';

let api = null;
let chatHistory = [];
let pageContext = null;

async function init() {
  try {
    const config = await loadConfig();
    api = new SoulSearchAPI(config);
    
    const ok = await api.ping();
    setStatus(ok ? 'connected' : 'error', ok ? 'Agent ready' : 'Check settings in popup');
    
    // Get page context
    const ctx = await getPageText();
    if (ctx) {
      pageContext = ctx;
      $('ss-page-title').textContent = ctx.title || ctx.url || '--';
    }
  } catch (e) {
    console.error('SoulSearch sidepanel init error:', e);
    setStatus('error', 'Error: ' + e.message);
  }
}

async function loadConfig() {
  const defaults = {
    provider: 'anthropic', llmKey: '', model: 'claude-3-haiku-20240307',
    agentProvider: '', agentApiKey: '', agentModel: '', agentOllamaUrl: '',
    ollamaUrl: 'http://localhost:11434', braveApiKey: ''
  };
  const local = await chrome.storage.local.get(defaults);
  return Object.assign({}, defaults, local);
}

$('ss-send-btn').addEventListener('click', runAgent);
$('ss-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent(); }
});

async function runAgent() {
  const input = $('ss-input');
  const task = input.value.trim();
  if (!task) return;
  input.value = '';
  appendMessage('user', task);
  chatHistory.push({ role: 'user', content: task });

  appendMessage('system', '[Agent] Starting...');
  
  try {
    const result = await api.agentRun(task, function(step) {
      if (step.type === 'thought' && step.text) {
        appendMessage('system', '[Agent] ' + step.text);
      } else if (step.type === 'action') {
        var d = step.tool.replace(/_/g, ' ');
        if (step.input && step.input.element_id) d += ' [' + step.input.element_id + ']';
        if (step.input && step.input.text) d += ': "' + step.input.text.slice(0, 40) + '"';
        appendMessage('system', '[Agent] > ' + d);
      } else if (step.type === 'done') {
        appendMessage('system', '[Agent] done: ' + (step.text || '').slice(0, 60));
      }
    });
    appendMessage('assistant', result);
    chatHistory.push({ role: 'assistant', content: result });
  } catch(err) {
    appendMessage('assistant', '⚠️ Agent error: ' + err.message);
  }
}

async function getPageText() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return null;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: function() {
        return {
          url: location.href,
          title: document.title,
          text: (document.body.innerText || '').slice(0, 8000)
        };
      }
    });
    return results?.[0]?.result || null;
  } catch(e) { return null; }
}

// ============================================================
// MEMORY FUNCTIONS
// ============================================================

async function saveToMemory(text, source) {
  const stored = await chrome.storage.local.get(['soul_memory']);
  const existing = stored.soul_memory || '';
  const date = new Date().toISOString().slice(0, 10);
  const entry = '\n\n[' + date + (source ? ' | ' + source.slice(0, 60) : '') + ']\n' + text.slice(0, 800);
  const updated = existing + entry;
  await chrome.storage.local.set({ soul_memory: updated });
}

async function saveToSessionMemory(text, source) {
  const s = await chrome.storage.local.get([SESSION_KEY, CURRENT_KEY]);
  const sessions = s[SESSION_KEY] || {};
  const currentId = s[CURRENT_KEY];
  
  if (!currentId || !sessions[currentId]) return;
  
  const date = new Date().toISOString().slice(0, 10);
  const entry = '[' + date + (source ? ' | ' + source.slice(0, 40) : '') + '] ' + text.slice(0, 500) + '\n';
  
  sessions[currentId].sessionMemory = (sessions[currentId].sessionMemory || '') + entry;
  await chrome.storage.local.set({ [SESSION_KEY]: sessions });
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
    
    // Add save buttons container
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
    globalBtn.addEventListener('click', async function() {
      await saveToMemory(content, pageContext ? pageContext.url : '');
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
}

function setStatus(state, text) {
  $('ss-dot').className = 'ss-dot ' + state;
  $('ss-status-text').textContent = text;
}

init();
