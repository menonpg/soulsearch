// SoulSearch API layer
// Calls LLM providers directly (Anthropic / OpenAI / Gemini).
// No middleware or proxy required — your API key stays on your device.

export class SoulSearchAPI {
  constructor(config) {
    this.provider = config.provider || 'anthropic';
    this.llmKey   = config.llmKey   || '';
    this.soul     = config.soul     || 'I am a research assistant with persistent memory. I help you understand and research web content.';
    this.model    = config.model    || 'claude-3-haiku-20240307';
    // SoulMate API optional — only used if explicitly configured with a key
    this.apiUrl   = config.apiUrl?.replace(/\/$/, '') || '';
    this.apiKey   = config.apiKey   || '';
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  ping() {
    // Ready if an LLM key is configured — no network call needed
    return Promise.resolve(!!this.llmKey);
  }

  // ── Core ask ─────────────────────────────────────────────────────────────────

  async ask(query, pageContext = null, history = []) {
    if (!this.llmKey) throw new Error('No LLM key set — open Settings and add your API key');

    // Build system prompt: soul → page context (primary) → memory (background)
    const cached = await chrome.storage.local.get(['soul_memory', 'soul_soul']);
    const soulIdentity = cached.soul_soul || this.soul;

    let systemParts = [soulIdentity];

    // Page context comes FIRST — if the user asks about the page, this is the source of truth
    if (pageContext) {
      systemParts.push(`\n\n--- Current Page (answer questions about this page from here) ---\n${pageContext}`);
    }

    // Memory is background context — useful for personalisation, not primary source
    if (cached.soul_memory) {
      systemParts.push(`\n\n--- Your Background Memory (use as context, not as the primary answer unless directly relevant) ---\n${cached.soul_memory.slice(0, 6000)}`);
    }

    const systemPrompt = systemParts.join('');

    // Build message history (last 10 turns)
    const msgs = [
      ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query }
    ];

    switch (this.provider) {
      case 'anthropic': return this._callAnthropic(systemPrompt, msgs);
      case 'openai':    return this._callOpenAI(systemPrompt, msgs);
      case 'gemini':    return this._callGemini(systemPrompt, msgs);
      default:          throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  // ── Anthropic (Claude) ───────────────────────────────────────────────────────

  async _callAnthropic(system, messages) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.llmKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: this.model || 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system,
        messages
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`Anthropic ${r.status}: ${err.error?.message || r.statusText}`);
    }
    const data = await r.json();
    return { answer: data.content[0].text, memory_used: null };
  }

  // ── OpenAI (GPT) ─────────────────────────────────────────────────────────────

  async _callOpenAI(system, messages) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.llmKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, ...messages]
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`OpenAI ${r.status}: ${err.error?.message || r.statusText}`);
    }
    const data = await r.json();
    return { answer: data.choices[0].message.content, memory_used: null };
  }

  // ── Gemini ───────────────────────────────────────────────────────────────────

  async _callGemini(system, messages) {
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.llmKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents
        }),
        signal: AbortSignal.timeout(30000)
      }
    );

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(`Gemini ${r.status}: ${err.error?.message || r.statusText}`);
    }
    const data = await r.json();
    return { answer: data.candidates[0].content.parts[0].text, memory_used: null };
  }

  // ── Memory helpers ────────────────────────────────────────────────────────────

  async remember(text, source = '') {
    const stored = await chrome.storage.local.get(['soul_memory']);
    const existing = stored.soul_memory || '';
    const entry = `\n[${new Date().toISOString().slice(0,10)}] ${source ? `(${source}) ` : ''}${text}`;
    await chrome.storage.local.set({ soul_memory: existing + entry });
    return { ok: true };
  }

  async getMemoryPeek() {
    const stored = await chrome.storage.local.get(['soul_memory']);
    const mem = stored.soul_memory || '';
    if (!mem) return null;
    // Return last 200 chars as a snippet
    return mem.slice(-200).trim();
  }

  async searchMemory(query) {
    const stored = await chrome.storage.local.get(['soul_memory']);
    const mem = stored.soul_memory || '';
    const lines = mem.split('\n').filter(l =>
      l.toLowerCase().includes(query.toLowerCase())
    );
    return { results: lines };
  }
}
