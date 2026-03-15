# SoulSearch 🔍🧠

> AI browser extension with persistent memory, powered by [soul.py](https://github.com/menonpg/soul.py)

SoulSearch brings soul.py's memory and identity layer directly into your browser. Ask questions about any webpage, build research threads that persist across sessions, and let the AI remember your context — not just your last message.

## What makes it different

Most AI browser tools are stateless. Every session starts from scratch. SoulSearch is different because it's backed by [soul.py](https://pypi.org/project/soul-agent/) — the persistent agent identity library. It remembers what you've researched, your preferences, and your ongoing projects.

| Feature | SoulSearch | Typical AI Extensions |
|---|---|---|
| Persistent memory across sessions | ✅ | ❌ |
| Configurable agent identity | ✅ | ❌ |
| Open source + self-hostable | ✅ | ❌ |
| Any LLM (Anthropic/OpenAI/Gemini) | ✅ | ⚠️ locked |
| Page context extraction | ✅ | ✅ |
| Right-click → Ask | ✅ | ⚠️ some |

## Quick start

### 1. Load the extension (developer mode)
1. Clone this repo
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `soulsearch/` folder

### 2. Configure
Click the ⚙ Settings icon and enter:
- **SoulMate API URL** — use the hosted instance (`https://soulmate-api-production.up.railway.app`) or [run your own](https://github.com/menonpg/soul.py)
- **LLM Provider** — Anthropic, OpenAI, or Gemini
- **LLM API Key** — your key for the chosen provider
- **Soul Identity** — define who the AI is (SOUL.md content)

### 3. Use it
- Click the extension icon on any page
- Ask a question — the AI automatically reads the page
- Right-click any selection → **Ask SoulSearch** or **Save to memory**
- Memory persists across all your sessions

## Self-hosting the memory backend

```bash
pip install soul-agent
soul init
soul serve  # starts local API on :8000
```

Then set your SoulMate API URL to `http://localhost:8000` in settings.

## Architecture

```
Chrome Extension (MV3)
├── popup/          — UI: chat interface, settings
├── content/        — Page context extraction
├── background/     — Context menus, session tracking
└── api/            — SoulMate API client

SoulMate API (soul.py backend)
├── /ask            — Query with memory injection
├── /memory         — Store and retrieve memories
└── /health         — Connection check
```

## Contributing

PRs welcome. See [ROADMAP.md](ROADMAP.md) for planned features.

## License

MIT — same as soul.py

---

Built on [soul.py](https://github.com/menonpg/soul.py) · by [ThinkCreate.AI](https://thinkcreateai.com)
