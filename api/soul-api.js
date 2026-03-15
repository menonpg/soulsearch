// SoulSearch API layer — connects to SoulMate API or local soul.py instance

export class SoulSearchAPI {
  constructor(config) {
    this.apiUrl = config.apiUrl?.replace(/\/$/, '') || 'https://soulmate-api-production.up.railway.app';
    this.apiKey = config.apiKey || '';
    this.provider = config.provider || 'anthropic';
    this.llmKey = config.llmKey || '';
    this.soul = config.soul || '';
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  // Health check
  async ping() {
    try {
      const r = await fetch(`${this.apiUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      return r.ok;
    } catch { return false; }
  }

  // Core: ask with memory injection + page context
  async ask(query, pageContext = null, history = []) {
    const messages = [
      ...(this.soul ? [{ role: 'system', content: this.soul }] : []),
      ...(pageContext ? [{ role: 'system', content: `Current page context:\n${pageContext}` }] : []),
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: query }
    ];

    const body = {
      query,
      messages,
      provider: this.provider,
      llm_key: this.llmKey,
      page_context: pageContext,
      inject_memory: true
    };

    const r = await fetch(`${this.apiUrl}/ask`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!r.ok) throw new Error(`API error ${r.status}`);
    return r.json(); // { answer, route, memory_used, ... }
  }

  // Save something to memory
  async remember(text, source = '') {
    const r = await fetch(`${this.apiUrl}/memory`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ text, source, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`Memory save failed ${r.status}`);
    return r.json();
  }

  // Get recent memory snippet for the UI peek
  async getMemoryPeek() {
    try {
      const r = await fetch(`${this.apiUrl}/memory/peek`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000)
      });
      if (!r.ok) return null;
      const data = await r.json();
      return data.snippet || null;
    } catch { return null; }
  }

  // Search memory
  async searchMemory(query) {
    const r = await fetch(`${this.apiUrl}/memory/search?q=${encodeURIComponent(query)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) throw new Error(`Memory search failed ${r.status}`);
    return r.json(); // { results: [...] }
  }
}
