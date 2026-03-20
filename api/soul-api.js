// SoulSearch API layer
// Calls LLM providers directly (Anthropic / OpenAI / Gemini).
// No middleware or proxy required - your API key stays on your device.

import { braveSearch } from './brave-search.js';

export class SoulSearchAPI {
  constructor(config) {
    this.provider = config.provider || 'anthropic';
    this.llmKey   = config.llmKey   || '';
    this.soul     = config.soul     || 'I am a research assistant with persistent memory. I help you understand and research web content.';
    this.model    = config.model    || 'claude-3-haiku-20240307';
    this.agentModel = config.agentModel || '';
    // Agent-specific provider settings (fall back to chat settings if empty)
    this.agentProvider = config.agentProvider || '';
    this.agentApiKey = config.agentApiKey || '';
    this.agentOllamaUrl = config.agentOllamaUrl || '';
    // SoulMate API optional - only used if explicitly configured with a key
    this.apiUrl   = config.apiUrl?.replace(/\/$/, '') || '';
    this.apiKey   = config.apiKey   || '';
    // Memory context limit (chars) - newest memories are at top, truncate from end
    this.memoryLimit = config.memoryLimit || 8000;
    // Ollama base URL (defaults to localhost)
    this.ollamaUrl = config.ollamaUrl?.replace(/\/$/, '') || 'http://localhost:11434';
    // Memory strategy: 'truncate' (fast) or 'rlm' (thorough - compresses long memory)
    this.memoryStrategy = config.memoryStrategy || 'truncate';
    // RLM compression threshold (chars) - compress if memory exceeds this
    this.rlmThreshold = config.rlmThreshold || 6000;
    // Brave Search API key (optional)
    this.braveApiKey = config.braveApiKey || '';
  }

  // -- Status ------------------------------------------------------------------

  ping() {
    // Ready if an LLM key is configured (or using Ollama which doesn't need one)
    if (this.provider === 'ollama') {
      return fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
        .then(r => r.ok)
        .catch(() => false);
    }
    return Promise.resolve(!!this.llmKey);
  }

  // -- Core ask -----------------------------------------------------------------

  async ask(query, pageContext = null, history = [], sessionId = null) {
    if (!this.llmKey && this.provider !== 'ollama') {
      throw new Error('No LLM key set - open Settings and add your API key');
    }

    // Build system prompt: soul - page context (primary) - memory (background)
    const cached = await chrome.storage.local.get(['soul_memory', 'soul_soul', 'ss_sessions']);
    const defaultSoul = 'You are SoulSearch, a helpful AI research assistant embedded in the browser. ' +
      'You have access to the current page content and the user\'s personal memory. ' +
      'When asked about the current page, answer from the page content. ' +
      'Be concise, insightful, and cite specific details from the page when relevant.';
    const soulIdentity = cached.soul_soul || this.soul || defaultSoul;

    let systemParts = [soulIdentity];

    // Note: Web search is available in Agent Mode as a tool the model can call
    if (this.braveApiKey) {
      systemParts.push('\n(Note: For web searches, enable Agent Mode which has web_search as a tool.)');
    }

    // Page context comes FIRST - if the user asks about the page, this is the source of truth
    if (pageContext) {
      systemParts.push(`\n\n--- Current Page (answer questions about this page from here) ---\n${pageContext}`);
    }

    // Session-specific memory (always included for this session)
    if (sessionId && cached.ss_sessions) {
      const session = cached.ss_sessions[sessionId];
      if (session && session.sessionMemory) {
        systemParts.push(`\n\n--- Session Memory (specific context for this conversation) ---\n${session.sessionMemory}`);
      }
    }

    // Global memory - apply memory strategy
    if (cached.soul_memory) {
      let mem = cached.soul_memory;
      
      // RLM strategy: compress memory if it exceeds threshold
      if (this.memoryStrategy === 'rlm' && mem.length > this.rlmThreshold) {
        try {
          mem = await this._compressMemory(mem);
        } catch (e) {
          console.warn('Memory compression failed, using truncation:', e.message);
          mem = mem.slice(0, this.memoryLimit);
        }
      } else {
        // Truncate strategy (default): simple character limit
        mem = mem.slice(0, this.memoryLimit);
      }
      
      systemParts.push(`\n\n--- Your Background Memory (use as context, not as the primary answer unless directly relevant) ---\n${mem}`);
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
      case 'ollama':    return this._callOllama(systemPrompt, msgs);
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

  // -- Ollama (local) -----------------------------------------------------------

  async _callOllama(system, messages) {
    const model = this.model || 'llama3.2';
    
    // Try OpenAI-compatible endpoint first
    const r = await fetch(`${this.ollamaUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (!r.ok) {
      // Fallback to native Ollama API
      const r2 = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, ...messages],
          stream: false
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!r2.ok) {
        const err = await r2.json().catch(() => ({}));
        throw new Error(`Ollama ${r2.status}: ${err.error || r2.statusText}. Is Ollama running?`);
      }
      const data = await r2.json();
      return { answer: data.message?.content || data.response, memory_used: null };
    }

    const data = await r.json();
    return { answer: data.choices[0].message.content, memory_used: null };
  }

  // -- Memory helpers ------------------------------------------------------------

  async remember(text, source = '') {
    const stored = await chrome.storage.local.get(['soul_memory']);
    const existing = stored.soul_memory || '';
    // Prepend new memories — newest first, so natural truncation keeps recent
    const entry = `[${new Date().toISOString().slice(0,10)}] ${source ? `(${source}) ` : ''}${text}\n`;
    await chrome.storage.local.set({ soul_memory: entry + existing });
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

  // -- RLM (Reflective Language Model) memory compression -----------------------
  // Asks the model to summarize/compress long memory while preserving key facts

  async _compressMemory(memory) {
    const compressionPrompt = `You are a memory compression assistant. Your task is to compress the following memory content while preserving all important facts, dates, names, decisions, and key insights. 

Output a compressed version that:
- Retains all specific facts (names, dates, numbers, URLs)
- Preserves the chronological order of events
- Removes redundant or repetitive information
- Uses concise language
- Keeps actionable items and decisions

Memory to compress:
${memory}

Compressed memory (aim for ~40% of original length):`;

    const msgs = [{ role: 'user', content: compressionPrompt }];
    const system = 'You are a precise memory compression assistant. Output only the compressed memory, no explanations.';

    let result;
    switch (this.provider) {
      case 'anthropic': result = await this._callAnthropic(system, msgs); break;
      case 'openai':    result = await this._callOpenAI(system, msgs); break;
      case 'gemini':    result = await this._callGemini(system, msgs); break;
      case 'ollama':    result = await this._callOllama(system, msgs); break;
      default:          throw new Error(`Unknown provider: ${this.provider}`);
    }

    return result.answer || memory.slice(0, this.memoryLimit);
  }

  // -- Session memory helpers ---------------------------------------------------

  async saveToSessionMemory(sessionId, text, source = '') {
    const stored = await chrome.storage.local.get(['ss_sessions']);
    const sessions = stored.ss_sessions || {};
    
    if (!sessions[sessionId]) {
      throw new Error('Session not found');
    }
    
    const date = new Date().toISOString().slice(0, 10);
    const entry = `[${date}${source ? ' | ' + source.slice(0, 60) : ''}] ${text.slice(0, 500)}\n`;
    
    sessions[sessionId].sessionMemory = (sessions[sessionId].sessionMemory || '') + entry;
    await chrome.storage.local.set({ ss_sessions: sessions });
    
    return { ok: true, sessionMemory: sessions[sessionId].sessionMemory };
  }

  async getSessionMemory(sessionId) {
    const stored = await chrome.storage.local.get(['ss_sessions']);
    const sessions = stored.ss_sessions || {};
    return sessions[sessionId]?.sessionMemory || '';
  }

  // -- Brave Search (manual trigger) --------------------------------------------

  async performSearch(query, count = 5) {
    if (!this.braveApiKey) {
      throw new Error('Brave API key not configured - add it in Settings');
    }
    return braveSearch(query, this.braveApiKey, count);
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
        name: 'wait',
        description: 'Wait for the page to update after an action. Use after clicking dropdowns or buttons before taking another snapshot.',
        input_schema: {
          type: 'object',
          properties: { ms: { type: 'number', description: 'Milliseconds to wait (100-2000)' } },
          required: []
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
      },
      {
        name: 'web_search',
        description: 'Search the web using Brave Search API. Use this when you need current information, news, or to look up something not on the current page.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }
    ];

    var cached = await chrome.storage.local.get(['soul_soul', 'soul_memory']);
    var identity = cached.soul_soul || this.soul || 'You are SoulSearch, a browser automation agent.';
    var system = 'You are a browser automation agent running inside a Chrome extension. ' +
      'IMPORTANT: You are ALREADY connected to the user\'s active browser tab -- the page is open in front of you. ' +
      'CAPABILITIES: You can browse the current page AND search the web using web_search. ' +
      'WORKFLOW: (1) snapshot_page first to see the page, (2) click/type/select to interact, (3) web_search to find current information online, (4) read_page to check results, (5) done() when complete. ' +
      'Use web_search when the user asks about current events, news, or information not on the page. ' +
      'DROPDOWNS: After clicking a combobox/dropdown trigger, ALWAYS call wait(500) then snapshot_page to see the expanded options before clicking an option. ' +
      'REACT PAGES: Setting values may not update React state -- prefer clicking elements over setting values directly. ' +
      'Never say you cannot access a page. ' +
      'Never say you cannot access the internet or search the web - you have the web_search tool available! Use it for any query about current events, news, or external information. ' +
      'Call done() with a clear summary of what was accomplished and the results you found.\n\n' +
      'User context: ' + identity.slice(0, 200);

    var messages = [{ role: 'user', content: task }];
    var maxSteps = 16;

    // Determine agent settings (fall back to chat settings if not specified)
    var effectiveAgentProvider = this.agentProvider || this.provider;
    var effectiveAgentKey = this.agentProvider ? (this.agentApiKey || this.llmKey) : this.llmKey;
    var effectiveAgentModel = this.agentModel || this.model;
    var effectiveAgentOllamaUrl = this.agentProvider === 'ollama' ? (this.agentOllamaUrl || this.ollamaUrl) : this.ollamaUrl;

    if (onStep) onStep({ type: 'thought', text: '[SoulSearch Agent] starting -- provider: ' + effectiveAgentProvider + ', model: ' + effectiveAgentModel });
    console.log('[SoulSearch Agent] starting, provider:', effectiveAgentProvider, ', model:', effectiveAgentModel, ', key length:', effectiveAgentKey ? effectiveAgentKey.length : 0);

    for (var step = 0; step < maxSteps; step++) {
      // Force wrap-up when approaching step limit
      if (step === maxSteps - 2) {
        messages.push({
          role: 'user',
          content: 'You are running low on steps. Please summarize your findings now and call done() with your complete answer.'
        });
      }

      var tc = (step === 0) ? { type: 'tool', name: 'snapshot_page' } : { type: 'auto' };
      if (onStep) onStep({ type: 'thought', text: '[Step ' + (step+1) + '] calling ' + effectiveAgentProvider + '...' });
      console.log('[SoulSearch Agent] step', step, 'provider:', effectiveAgentProvider, 'tool_choice:', JSON.stringify(tc));
      var resp;
      if (effectiveAgentProvider === 'ollama') {
        resp = await this._callOllamaTools(system, messages, tools, tc, effectiveAgentModel, effectiveAgentOllamaUrl);
      } else {
        resp = await this._callAnthropicTools(system, messages, tools, tc, effectiveAgentKey, effectiveAgentModel);
      }
      console.log('[SoulSearch Agent] step', step, 'stop_reason:', resp.stop_reason, 'content blocks:', resp.content ? resp.content.length : 0);

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
            var snapResult = await this._execInTab(function() {
              window.__ss_map = {};
              var id = 1; var els = [];
              var sel = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [role="button"], [role="combobox"], [role="option"], [role="menuitem"], [role="listitem"], [tabindex="0"]';
              document.querySelectorAll(sel).forEach(function(el) {
                var rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return;
                var st = window.getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden') return;
                var label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || el.innerText || '').trim().slice(0, 80);
                window.__ss_map[id] = el;
                els.push({ id: id, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || el.getAttribute('role'), text: label });
                id++;
              });
              return { title: document.title, url: location.href, elements: els };
            }, []);
            var lines = (snapResult && snapResult.elements || []).map(function(e) {
              return '[' + e.id + '] ' + e.tag + (e.type ? '(' + e.type + ')' : '') + ': ' + (e.text || '(empty)');
            });
            if (onStep) onStep({ type: 'thought', text: '[snapshot] ' + lines.length + ' elements on: ' + (snapResult && snapResult.title || '?') });
            result = 'Page: ' + (snapResult && snapResult.title || '?') + '\nElements (' + lines.length + '):\n' + lines.slice(0, 60).join('\n');
          } else if (toolName === 'click') {
            var cr = await this._execInTab(function(eid) {
              var el = window.__ss_map && window.__ss_map[eid];
              if (!el) return { error: 'Element ' + eid + ' not found -- snapshot first' };
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.focus(); el.click();
              return { done: true, clicked: (el.getAttribute('aria-label') || el.value || el.innerText || '').slice(0, 50) };
            }, [input.element_id]);
            result = (cr && cr.error) ? ('Error: ' + cr.error) : JSON.stringify(cr);
            if (!cr || !cr.error) await new Promise(function(r) { setTimeout(r, 350); });
          } else if (toolName === 'type_text') {
            var tr = await this._execInTab(function(eid, text) {
              var el = window.__ss_map && window.__ss_map[eid];
              if (!el) return { error: 'Element ' + eid + ' not found -- snapshot first' };
              el.focus();
              var nd = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
              if (nd && nd.set) nd.set.call(el, text); else el.value = text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return { done: true, typed: text };
            }, [input.element_id, input.text]);
            result = (tr && tr.error) ? ('Error: ' + tr.error) : JSON.stringify(tr);
          } else if (toolName === 'select_option') {
            var sr = await this._execInTab(function(eid, val) {
              var el = window.__ss_map && window.__ss_map[eid];
              if (!el) return { error: 'Element ' + eid + ' not found -- snapshot first' };
              el.scrollIntoView({ block: 'center' });
              if (el.tagName === 'SELECT') {
                el.value = val; el.dispatchEvent(new Event('change', { bubbles: true }));
                return { done: true, selected: val };
              }
              el.click();
              return { done: true, clicked_custom_dropdown: val };
            }, [input.element_id, input.value]);
            result = (sr && sr.error) ? ('Error: ' + sr.error) : JSON.stringify(sr);
            if (!sr || !sr.error) await new Promise(function(r) { setTimeout(r, 350); });
          } else if (toolName === 'scroll') {
            await this._execInTab(function(dir) {
              if (dir === 'down') window.scrollBy(0, 400);
              else if (dir === 'up') window.scrollBy(0, -400);
              else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
              else window.scrollTo(0, 0);
              return true;
            }, [input.direction]);
            result = 'Scrolled ' + input.direction;
          } else if (toolName === 'read_page') {
            var rr = await this._execInTab(function() {
              return (document.body.innerText || '').slice(0, 2000);
            }, []);
            result = rr || 'No content';
          } else if (toolName === 'navigate') {
            await this._execInTab(function(url) { window.location.href = url; }, [input.url]);
            result = 'Navigating to ' + input.url;
          } else if (toolName === 'wait') {
            var waitMs = Math.min(Math.max(input.ms || 500, 100), 2000);
            await new Promise(function(r) { setTimeout(r, waitMs); });
            result = 'Waited ' + waitMs + 'ms';
          } else if (toolName === 'web_search') {
            if (!this.braveApiKey) {
              result = 'Error: Brave Search not configured. Add API key in Settings.';
            } else {
              try {
                var searchQuery = input.query || '';
                var searchResults = await braveSearch(searchQuery, this.braveApiKey, 5);
                if (searchResults.length === 0) {
                  result = 'No search results found for: ' + searchQuery;
                } else {
                  result = 'Search results for "' + searchQuery + '":\n\n' + 
                    searchResults.map(function(r, i) {
                      return (i+1) + '. ' + r.title + '\n   ' + r.url + '\n   ' + r.snippet;
                    }).join('\n\n');
                }
                if (onStep) onStep({ type: 'thought', text: '[web_search] Found ' + searchResults.length + ' results for: ' + searchQuery });
              } catch (e) {
                result = 'Search error: ' + e.message;
              }
            }
          } else {
            result = 'Unknown tool: ' + toolName;
          }
        } catch(e) {
          result = 'Error: ' + e.message;
          console.error('[SoulSearch Agent] tool error:', toolName, e);
          if (onStep) onStep({ type: 'thought', text: '[Error] ' + toolName + ': ' + e.message });
        }

        toolResults.push({ tool_use_id: call.id, content: result });
      }

      // Format tool results based on provider
      if (effectiveAgentProvider === 'ollama') {
        // Ollama expects separate tool messages
        for (var j = 0; j < toolResults.length; j++) {
          messages.push({
            role: 'tool',
            content: toolResults[j].content,
            tool_call_id: toolResults[j].tool_use_id
          });
        }
      } else {
        // Anthropic expects tool_result in user message
        messages.push({
          role: 'user',
          content: toolResults.map(function(tr) {
            return { type: 'tool_result', tool_use_id: tr.tool_use_id, content: tr.content };
          })
        });
      }
    }

    return 'Max steps reached. The agent may not have completed the full task. Consider breaking it into smaller steps.';
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

  async _callAnthropicTools(system, messages, tools, toolChoice, apiKey, model) {
    if (!toolChoice) toolChoice = { type: 'auto' };
    var keyToUse = apiKey || this.llmKey;
    var modelToUse = model || this.model || 'claude-3-5-haiku-20241022';
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': keyToUse,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: modelToUse,
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

  async _callOllamaTools(system, messages, tools, toolChoice, model, ollamaUrl) {
    // Convert Anthropic tool format to Ollama/OpenAI format
    var ollamaTools = tools.map(function(t) {
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      };
    });

    // Convert messages format - Ollama uses OpenAI-style messages
    var ollamaMessages = [{ role: 'system', content: system }];
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (m.role === 'tool') {
        // Tool result message (from previous iteration)
        ollamaMessages.push({
          role: 'tool',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          tool_call_id: m.tool_call_id
        });
      } else if (m.role === 'assistant' && Array.isArray(m.content)) {
        // Assistant message with potential tool calls
        var textContent = '';
        var toolCalls = [];
        for (var j = 0; j < m.content.length; j++) {
          var block = m.content[j];
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input)
              }
            });
          }
        }
        var assistantMsg = { role: 'assistant', content: textContent || '' };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        ollamaMessages.push(assistantMsg);
      } else {
        // Regular user/assistant message
        ollamaMessages.push({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        });
      }
    }

    var modelToUse = model || this.agentModel || this.model || 'llama3.2';
    var urlToUse = ollamaUrl || this.ollamaUrl || 'http://localhost:11434';
    var resp = await fetch(urlToUse + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        messages: ollamaMessages,
        tools: ollamaTools,
        stream: false
      }),
      signal: AbortSignal.timeout(120000)
    });

    if (!resp.ok) {
      var errText = await resp.text().catch(function() { return resp.statusText; });
      // Check for tool support error
      if (errText.includes('does not support tools')) {
        throw new Error('Model "' + modelToUse + '" doesn\'t support tools. Set a tool-capable Agent Model in Settings (e.g., llama3.2, qwen2.5)');
      }
      throw new Error('Ollama ' + resp.status + ': ' + errText);
    }
    var data = await resp.json();

    // Convert Ollama response to Anthropic-like format for compatibility
    var content = [];
    if (data.message && data.message.content) {
      content.push({ type: 'text', text: data.message.content });
    }
    if (data.message && data.message.tool_calls) {
      for (var k = 0; k < data.message.tool_calls.length; k++) {
        var tc = data.message.tool_calls[k];
        content.push({
          type: 'tool_use',
          id: tc.id || ('tool_' + Date.now() + '_' + k),
          name: tc.function.name,
          input: typeof tc.function.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments
        });
      }
    }

    return {
      content: content,
      stop_reason: (data.message && data.message.tool_calls && data.message.tool_calls.length) ? 'tool_use' : 'end_turn'
    };
  }


}