# SoulSearch 🔍🧠

> AI browser extension where your memory, identity, and config live in **your own private Git repo** — not on Google's servers.

Powered by [soul.py](https://github.com/menonpg/soul.py). Open source. Self-hostable.

---

## The privacy model

Every other AI browser extension syncs your settings through Google Chrome Sync — which means Google has your API keys, your preferences, and your context. SoulSearch doesn't do that.

**Your data lives in a private Git repo you control:**

```
your-private-repo/         ← GitHub / GitLab / Gitea / self-hosted / any Git
├── SOUL.md                ← who the AI is (your agent identity)
├── MEMORY.md              ← long-term memory (curated, persistent)
├── memory/
│   └── 2026-03-15.md      ← daily research notes
└── soulsearch-settings.json  ← non-sensitive config only
```

**Your device only (never leaves your machine, never in Git):**
```
chrome.storage.local       ← LLM API keys, Git access token
```

Use GitHub (private repo), GitLab, your own Gitea instance, Forgejo on a Raspberry Pi — any Git hosting with an HTTP API. You can even move between them. It's all plain text files.

---

## What makes it different

| | SoulSearch | Other AI Extensions |
|---|---|---|
| Memory persists across sessions | ✅ | ❌ |
| Memory stored in YOUR Git repo | ✅ | ❌ |
| Works with any Git host (GitHub, GitLab, Gitea, self-hosted) | ✅ | ❌ |
| API keys stored locally only (not Google Sync) | ✅ | ❌ |
| Open source + fully auditable | ✅ | ❌ |
| Any LLM (Anthropic / OpenAI / Gemini) | ✅ | ⚠️ locked |
| Configurable AI identity (SOUL.md) | ✅ | ❌ |
| Self-hostable memory backend | ✅ | ❌ |

---

## Quick start

### 1. Create your private memory repo

Create a new **private** repo (GitHub, GitLab, Gitea, or any host). Add a `SOUL.md`:

```markdown
# SOUL.md
I am a research assistant. I help with [your description].
My areas of focus: [your topics].
```

### 2. Load the extension

1. Clone this repo: `git clone https://github.com/menonpg/soulsearch`
2. Go to `chrome://extensions/`
3. Enable **Developer mode**
4. **Load unpacked** → select the `soulsearch/` folder

### 3. Configure

Click ⚙ Settings and enter:

**Git Config** (where your memory lives):
- Provider: GitHub / GitLab / Gitea
- Owner / Repo (e.g. `yourname/my-soulsearch-memory`)
- Access token (fine-grained token with repo read/write — stays on your device)

**LLM Config** (for AI responses):
- Provider: Anthropic / OpenAI / Gemini
- API Key (stored locally only, never in Git)

### 4. Use it

- Click the extension on any page — the AI automatically reads the page
- Conversations are memory-aware and context-rich
- Right-click any selection → **Ask SoulSearch** or **Save to memory**
- Memory automatically commits back to your private repo

---

## Self-hosting everything

For complete privacy — no GitHub, no cloud:

**Option A: Gitea on a Raspberry Pi**
```bash
# On your Pi
docker run -d --name gitea -p 3000:3000 gitea/gitea
# Access at http://192.168.x.x:3000
# Create a private repo, generate an access token
# In SoulSearch settings: Provider=Gitea, Host=192.168.x.x:3000
```

**Option B: Forgejo (Gitea fork, more community-driven)**
```bash
docker run -d --name forgejo -p 3000:3000 codeberg.org/forgejo/forgejo
```

**Option C: Local soul.py backend (no cloud LLM)**
```bash
pip install soul-agent
soul init
soul serve --local --model ollama/llama3.2  # fully offline
```

---

## Architecture

```
Chrome Extension (MV3)
├── popup/            — Dark-mode chat UI, settings, memory peek
├── content/          — Page context extraction (smart text parser)
├── background/       — Context menus, session tracking
└── api/
    ├── soul-api.js   — SoulMate/soul.py API client (optional cloud)
    └── git-storage.js — Git-backed memory: GitHub / GitLab / Gitea / any

Your Private Git Repo
├── SOUL.md           — Agent identity
├── MEMORY.md         — Persistent memory
└── memory/           — Daily notes
```

---

## Git provider support

| Provider | Status | Notes |
|---|---|---|
| GitHub (private repo) | ✅ | Use fine-grained PAT with repo scope |
| GitLab (gitlab.com or self-hosted) | ✅ | Use project access token |
| Gitea / Forgejo (self-hosted) | ✅ | Works with any Gitea instance |
| Any Gitea-compatible host | ✅ | Codeberg, etc. |
| SSH-only remotes | 🔜 v0.3 | Planned |

---

## Contributing

PRs welcome. See [ROADMAP.md](ROADMAP.md).

## License

MIT — same as [soul.py](https://github.com/menonpg/soul.py)

---

*Built on [soul.py](https://github.com/menonpg/soul.py) · [ThinkCreate.AI](https://thinkcreateai.com) · [Blog](https://blog.themenonlab.com)*
