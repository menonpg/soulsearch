// SoulSearch API layer
// Calls LLM providers directly (Anthropic / OpenAI / Gemini).
// No middleware or proxy required - your API key stays on your device.

export class SoulSearchAPI {
  constructor(config) {
    this.provider = config.provider || 'anthropic';
    this.llmKey   = config.llmKey   || '';
    this.soul     = config.soul     || 'I am a research assistant with persistent memory. I help you understand and research web content.';
    this.model    = config.model    || 'claude-3-haiku-20240307';
    // SoulMate API optional - only used if explicitly configured with a key
    this.apiUrl   = config.apiUrl?.replace(/\/$/, '') || '';
    this.apiKey   = config.apiKey   || '';
  }

  // -- Status ------------------------------------------------------------------

  ping() {
    // Ready if an LLM key is configured - no network call needed
    return Promise.resolve(!!this.llmKey);
  }

  // -- Core ask -----------------------------------------------------------------

  async ask(query, pageContext = null, history = []) {
    if (!this.llmKey) throw new Error('No LLM key set - open Settings and add your API key');

    // Build system prompt: soul - page context (primary) - memory (background)
    const cached = await chrome.storage.local.get(['soul_memory', 'soul_soul']);
    const defaultSoul = 'You are SoulSearch, a helpful AI research assistant embedded in the browser. ' +
      'You have access to the current page content and the user\'s personal memory. ' +
      'When asked about the current page, answer from the page content. ' +
      'Be concise, insightful, and cite specific details from the page when relevant.';
    const soulIdentity = cached.soul_soul || this.soul || defaultSoul;

    let systemParts = [soulIdentity];

    // Page context comes FIRST - if the user asks about the page, this is the source of truth
    if (pageContext) {
      systemParts.push(`\n\n--- Current Page (answer questions about this page from here) ---\n${pageContext}`);
    }

    // Memory is background context - useful for personalisation, not primary source
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

  // -- Anthropic (Claude) -------------------------------------------------------

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

  // -- OpenAI (GPT) -------------------------------------------------------------

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

  // -- Gemini -------------------------------------------------------------------

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

  // -- Memory helpers ------------------------------------------------------------

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
  // ---- Agent mode: multi-step tool calling loop -------------------------

  async agentRun(task, onStep) {
    var tools = [
      {
        name: 'snapshot_page',
        description: 'Get a numbered list of all interactive elements (buttons, inputs, links) on the current page. Always call this before clicking or typing.',
        input_schema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'click',
        description: 'Click an element by its ID number from the snapshot.',
        input_schema: {
          type: 'object',
          properties: { element_id: { type: 'number', description: 'Element ID from snapshot' } },
          required: ['element_id']
        }
      },
      {
        name: 'type_text',
        description: 'Type text into an input field or textarea.',
        input_schema: {
          type: 'object',
          properties: {
            element_id: { type: 'number', description: 'Element ID from snapshot' },
            text: { type: 'string', description: 'Text to type' }
          },
          required: ['element_id', 'text']
        }
      },
      {
        name: 'select_option',
        description: 'Select a value from a dropdown or select element. Use for <select> elements or custom dropdowns.',
        input_schema: {
          type: 'object',
          properties: {
            element_id: { type: 'number', description: 'Element ID from snapshot' },
            value: { type: 'string', description: 'Option text or value to select' }
          },
          required: ['element_id', 'value']
        }
      },
      {
        name: 'scroll',
        description: 'Scroll the page.',
        input_schema: {
          type: 'object',
          properties: { direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] } },
          required: ['direction']
        }
      },
      {
        name: 'read_page',
        description: 'Read the current page text to check results or find information.',
        input_schema: { type: 'object', properties: {}, required: [] }
      },
      {
        name: 'navigate',
        description: 'Navigate the browser to a URL.',
        input_schema: {
          type: 'object',
          properties: { url: { type: 'string' } },
          required: ['url']
        }
      },
      {
        name: 'done',
        description: 'Mark the task as complete. Call this when finished.',
        input_schema: {
          type: 'object',
          properties: { summary: { type: 'string', description: 'What was accomplished' } },
          required: ['summary']
        }
      }
    ];

    var cached = await chrome.storage.local.get(['soul_soul', 'soul_memory']);
    var identity = cached.soul_soul || this.soul || 'You are SoulSearch, a browser automation agent.';
    var system = 'You are a browser automation agent running inside a Chrome extension. ' +
      'IMPORTANT: You are ALREADY connected to the user\'s active browser tab. ' +
      'You do NOT need to navigate anywhere or "connect" to a page -- it is already open. ' +
      'Your FIRST action must ALWAYS be snapshot_page to see what interactive elements exist on the current page. ' +
      'Then use click, type_text, select_option, and scroll to complete the task. ' +
      'Never say you cannot access a page -- use snapshot_page immediately. ' +
      'Call done() with a summary when the task is complete.\n\n' +
      'User context: ' + identity.slice(0, 300);

    var messages = [{ role: 'user', content: task }];
    var maxSteps = 12;

    for (var step = 0; step < maxSteps; step++) {
      var tc = (step === 0) ? { type: 'tool', name: 'snapshot_page' } : { type: 'auto' };
      var resp = await this._callAnthropicTools(system, messages, tools, tc);

      // Collect text and tool_use blocks
      var textParts = [];
      var toolCalls = [];
      if (Array.isArray(resp.content)) {
        resp.content.forEach(function(block) {
          if (block.type === 'text' && block.text) textParts.push(block.text);
          if (block.type === 'tool_use') toolCalls.push(block);
        });
      }

      if (textParts.length && onStep) onStep({ type: 'thought', text: textParts.join(' ') });

      // No tools called = model finished
      if (toolCalls.length === 0 || resp.stop_reason === 'end_turn') {
        var final = textParts.join(' ') || 'Done.';
        if (onStep) onStep({ type: 'done', text: final });
        return final;
      }

      messages.push({ role: 'assistant', content: resp.content });

      var toolResults = [];
      for (var i = 0; i < toolCalls.length; i++) {
        var call = toolCalls[i];
        var toolName = call.name;
        var input = call.input || {};
        if (onStep) onStep({ type: 'action', tool: toolName, input: input });

        var result;
        try {
          if (toolName === 'done') {
            if (onStep) onStep({ type: 'done', text: input.summary });
            return input.summary;
          } else if (toolName === 'snapshot_page') {
            var snap = await this._tabMessage({ type: 'GET_SNAPSHOT' });
            var lines = (snap.snapshot.elements || []).map(function(e) {
              return '[' + e.id + '] ' + e.tag + (e.type ? '(' + e.type + ')' : '') + ': ' + (e.text || '(no label)');
            });
            result = 'Page: ' + snap.snapshot.title + '\n' + lines.join('\n');
          } else if (toolName === 'click') {
            var r = await this._tabMessage({ type: 'EXECUTE_ACTION', action: 'click', elementId: input.element_id });
            result = r.error ? ('Error: ' + r.error) : JSON.stringify(r.result);
          } else if (toolName === 'type_text') {
            var r2 = await this._tabMessage({ type: 'EXECUTE_ACTION', action: 'type', elementId: input.element_id, value: input.text });
            result = r2.error ? ('Error: ' + r2.error) : JSON.stringify(r2.result);
          } else if (toolName === 'scroll') {
            var r3 = await this._tabMessage({ type: 'EXECUTE_ACTION', action: 'scroll', value: input.direction });
            result = 'Scrolled ' + input.direction;
          } else if (toolName === 'select_option') {
            var rs = await this._tabMessage({ type: 'EXECUTE_ACTION', action: 'select', elementId: input.element_id, value: input.value });
            result = rs.error ? ('Error: ' + rs.error) : JSON.stringify(rs.result);
          } else if (toolName === 'read_page') {
            var r4 = await this._tabMessage({ type: 'GET_CONTEXT' });
            result = (r4.context && r4.context.text) ? r4.context.text.slice(0, 2000) : 'No content';
          } else if (toolName === 'navigate') {
            await this._tabMessage({ type: 'EXECUTE_ACTION', action: 'navigate', value: input.url });
            result = 'Navigating to ' + input.url;
          } else {
            result = 'Unknown tool: ' + toolName;
          }
        } catch(e) {
          result = 'Error: ' + e.message;
        }

        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: result });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return 'Max steps reached without completion.';
  }

  async _tabMessage(msg) {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) throw new Error('No active tab');
    return new Promise(function(resolve, reject) {
      chrome.tabs.sendMessage(tabs[0].id, msg, function(response) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(response);
      });
    });
  }

  async _execInTab(fn, args) {
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) throw new Error('No active tab');
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: fn,
      args: args || []
    });
    return results && results[0] ? results[0].result : null;
  }

  async _callAnthropicTools(system, messages, tools, toolChoice) {
    if (!toolChoice) toolChoice = { type: 'auto' };
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.llmKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model || 'claude-3-5-haiku-20241022',
        max_tokens: 2048,
        system: system,
        messages: messages,
        tools: tools
      })
    });
    if (!r.ok) {
      var err = await r.json().catch(function() { return {}; });
      throw new Error('Anthropic ' + r.status + ': ' + ((err.error && err.error.message) || r.statusText));
    }
    return r.json();
  }


}