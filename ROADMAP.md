# SoulSearch Roadmap

## v0.1 — MVP (current)
- [x] Chrome extension scaffold (Manifest V3)
- [x] Popup UI — chat interface, settings, memory peek
- [x] Page context extraction (content script)
- [x] SoulMate API integration (ask, memory, health)
- [x] Right-click context menu (Ask, Save to memory, Summarize page)
- [x] Session chat history (stored locally)
- [x] Multi-LLM support (Anthropic, OpenAI, Gemini)
- [ ] Extension icons (SVG → PNG pipeline)
- [ ] Chrome Web Store listing

## v0.2 — Research Workflows
- [ ] **Deep Research mode** — multi-step web research with memory accumulation
- [ ] **Research threads** — named projects, persistent across sessions
- [ ] **Save highlights** — select text → save to memory with source URL
- [ ] **Page summarization** — one-click summary with memory-aware context
- [ ] **Prompt enhancer** — rewrite queries based on page context + memory
- [ ] **Side panel mode** — persistent panel alongside browsing (Chrome Side Panel API)

## v0.3 — Memory & Identity
- [ ] **Memory browser** — view, edit, delete stored memories from the popup
- [ ] **Memory search** — search across all stored memories
- [ ] **Identity profiles** — switch between SOUL.md configurations (work/personal/research)
- [ ] **Memory export** — download memories as MEMORY.md (soul.py format)
- [ ] **Auto-memory** — optional: automatically save key facts from pages you visit

## v0.4 — Power Features
- [ ] **Streaming responses** — streaming LLM output for faster feel
- [ ] **PDF support** — extract and query PDF content in-browser
- [ ] **YouTube transcripts** — auto-extract and summarize YouTube videos
- [ ] **Web search integration** — trigger searches from within the chat
- [ ] **Citation tracking** — automatically cite sources in responses

## v1.0 — Production
- [ ] **Firefox port** — Manifest V3 cross-browser compatibility
- [ ] **Local soul.py backend** — bundle or connect to local soul.py instance (no cloud required)
- [ ] **End-to-end encryption** — encrypted memory storage
- [ ] **Team memory** — shared memory backends for teams
- [ ] **Chrome Web Store** — public listing

## Future / Electron v2
- Full AI browser shell (Electron + Chromium)
- Deeper browser integration (new tab page, URL bar AI, tab management)
- Bundle soul.py locally — fully offline operation
- Custom browser UI with memory timeline
