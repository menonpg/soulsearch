// SoulSearch popup — main UI controller
import { SoulSearchAPI } from '../api/soul-api.js';

const $ = id => document.getElementById(id);

let pageContext = null;
let includeContext = true;
let api = null;
let chatHistory = [];

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const config = await loadConfig();
  api = new SoulSearchAPI(config);

  // Test connection
  const ok = await api.ping();
  setStatus(ok ? 'connected' : 'error', ok ? 'Memory active' : 'No API — check settings');

  // Get page context from active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $('ss-page-title').textContent = tab.title || tab.url || '—';
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_CONTEXT' });
      if (resp?.context) pageContext = resp.context;
    } catch (e) {
      // Content script not injected (chrome:// pages etc.)
    }
  }

  // Restore chat history
  const stored = await chrome.storage.local.get('chatHistory');
  if (stored.chatHistory?.length) {
    chatHistory = stored.chatHistory.slice(-20); // last 20 messages
    chatHistory.forEach(m => appendMessage(m.role, m.content));
  }

  // Show memory peek if available
  if (ok) {
    const memory = await api.getMemoryPeek();
    if (memory) {
      $('ss-memory-peek').style.display = 'block';
      $('ss-memory-text').textContent = memory;
    }
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
  $('ss-ctx-btn').title = includeContext ? 'Page context: ON' : 'Page context: OFF';
});
$('ss-mem-btn').addEventListener('click', async () => {
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

// ── Core: send message ────────────────────────────────────────────────────────

async function sendMessage() {
  const input = $('ss-input');
  const query = input.value.trim();
  if (!query) return;

  input.value = '';
  appendMessage('user', query);
  chatHistory.push({ role: 'user', content: query });

  const loadingEl = appendMessage('loading', '⏳ Thinking...');

  try {
    const context = includeContext && pageContext
      ? `[Page: ${pageContext.title}]\n${pageContext.text?.slice(0, 3000)}`
      : null;

    const response = await api.ask(query, context, chatHistory.slice(-10));
    loadingEl.remove();
    appendMessage('assistant', response.answer);
    chatHistory.push({ role: 'assistant', content: response.answer });

    // Update memory peek
    if (response.memory_used) {
      $('ss-memory-peek').style.display = 'block';
      $('ss-memory-text').textContent = response.memory_used;
    }

    // Persist chat
    await chrome.storage.local.set({ chatHistory: chatHistory.slice(-40) });
  } catch (err) {
    loadingEl.remove();
    appendMessage('assistant', `⚠️ Error: ${err.message}. Check your settings.`);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function appendMessage(role, content) {
  const chat = $('ss-chat');
  const el = document.createElement('div');
  el.className = `ss-message ss-message--${role}`;
  el.textContent = content;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

function setStatus(state, text) {
  const dot = $('ss-dot');
  dot.className = `ss-dot ${state}`;
  $('ss-status-text').textContent = text;
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadConfig() {
  const defaults = {
    apiUrl: 'https://soulmate-api-production.up.railway.app',
    apiKey: '',
    provider: 'anthropic',
    llmKey: '',
    soul: 'I am a research assistant with persistent memory. I help you understand and research web content.'
  };
  const stored = await chrome.storage.sync.get(defaults);
  return { ...defaults, ...stored };
}

async function showSettings() {
  const config = await loadConfig();
  $('cfg-api-url').value = config.apiUrl;
  $('cfg-api-key').value = config.apiKey;
  $('cfg-provider').value = config.provider;
  $('cfg-llm-key').value = config.llmKey;
  $('cfg-soul').value = config.soul;
  $('ss-settings').style.display = 'block';
}

async function saveSettings() {
  await chrome.storage.sync.set({
    apiUrl: $('cfg-api-url').value,
    apiKey: $('cfg-api-key').value,
    provider: $('cfg-provider').value,
    llmKey: $('cfg-llm-key').value,
    soul: $('cfg-soul').value
  });
  $('ss-settings').style.display = 'none';
  // Re-init with new config
  init();
}

init();
