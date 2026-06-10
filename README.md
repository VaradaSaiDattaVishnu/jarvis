# 🤖 J.A.R.V.I.S — Your Personal AI Voice Assistant

### 🔴 Live: **https://jarvis-production-1742.up.railway.app**

A real-time, voice-first AI assistant with persistent memory and an **agentic brain**.
Talk naturally, get instant spoken replies, and let JARVIS actually *do* things —
set reminders, manage tasks, search the web, read your documents, check your
calendar and email — by calling real tools, not just chatting.

Runs on **Groq** for free out of the box, and **auto-upgrades to Claude** the moment
you add an Anthropic API key.

---

## ✨ The three AI capabilities

1. **Agentic tool-calling** — JARVIS decides when to call tools (reminders, tasks,
   notes, web search, weather, news, calendar, email, smart-home, music, document
   search) inside a multi-turn loop, then narrates what it actually did. No brittle
   keyword routing — the model drives. Works on both Claude and Groq (with a
   recovery shim for Groq/Llama's text-format tool calls).
2. **Voice RAG over your documents** — Upload notes/docs in the **Documents** tab.
   They're chunked, embedded locally (all-MiniLM-L6-v2), and vector-searched. Ask a
   question and JARVIS answers from your files **with citations**.
3. **Proactive intelligence** — A background engine reasons over your tasks,
   calendar, and follow-ups to surface anticipatory suggestions on the Dashboard,
   plus morning briefings and smart nudges.

---

## ⚡ Quick start (local)

### 1. Get a FREE Groq API key
[console.groq.com/keys](https://console.groq.com/keys) → sign up → create a key.

### 2. Install
```bash
npm install                 # server deps
cd client && npm install    # client deps
cd ..
pip install edge-tts        # text-to-speech (or: pip install edge-tts --break-system-packages)
cp .env.example .env        # then add your GROQ_API_KEY
```

### 3. Run

**Production-style (single server, prebuilt UI):**
```bash
cd client && npm run build && cd ..   # builds the React app into /public
npm start                              # serve everything at http://localhost:3000
```

**Dev (hot-reload UI):**
```bash
npm run dev            # server on :3000
cd client && npm run dev   # Vite UI on :5173 (proxies /api + /audio to :3000)
```

Open **http://localhost:3000** (or :5173 in dev). First run launches a setup wizard.

---

## 🎮 How to use

| Action | How |
|--------|-----|
| **Voice input** | Click the 🎤 mic button |
| **Text input** | Type and press **Enter** |
| **Interrupt JARVIS** | Press **Escape** (barge-in) |
| **Add documents** | **Documents** tab → Add / upload a `.txt`/`.md` |
| **Set a PIN** | Settings → enables auth gating on sensitive actions |

Try: *"remind me to call mom tomorrow at 5pm"*, *"what's on my calendar today?"*,
*"what does my project brief say about the deadline?"* (after uploading it).

---

## 🏗️ Architecture

```
React + Zustand (Web Speech API)
        │  WebSocket (stream text + audio + tool events)
        ▼
Node.js / Express  ──► llm.js      agentStream(): multi-turn tool-calling loop
                   ├─► tools.js     ~20 callable tools, exposed by what's connected
                   ├─► rag.js       chunk → embed → vector search over docs
                   ├─► memory.js    SQLite: memory, profile, tasks, notes, follow-ups
                   ├─► briefing.js  proactive suggestions + morning briefing
                   └─► tts.js       Edge TTS (clause-level streaming for low latency)

LLM provider auto-detected: Anthropic key → Claude (claude-sonnet-4-6),
otherwise Groq (llama-3.3-70b-versatile).
```

---

## 🔌 Optional integrations

Configure these in the **Integrations** tab (validated on save, persisted to the DB
and `.env`): Anthropic (Claude), Google Calendar + Gmail, Spotify, Brave Search,
OpenWeather, Twilio (calls/SMS), Home Assistant. Each lights up the matching agent
tools automatically — JARVIS will tell you truthfully what it can and can't access.

---

## 🚀 Deploy (Docker / Railway)

The included `Dockerfile` builds the client and serves everything from one image.

```bash
docker build -t jarvis .
docker run -p 3000:3000 --env-file .env -v jarvis-data:/data jarvis
```

On **Railway**: point it at this repo (uses `railway.toml`), set `GROQ_API_KEY`
(and optionally `ANTHROPIC_API_KEY`, `JARVIS_ENCRYPTION_KEY`, VAPID keys,
`PUBLIC_URL`), and **mount a Volume at `/data`** so the DB, encryption key, VAPID
keypair and backups persist across deploys. See `railway.toml` for the full list.

---

## 💰 Cost

**$0/month** on the defaults: Groq free tier, Edge TTS (free), browser Speech API,
local SQLite, and local embeddings. Adding Claude/other integrations is optional.

---

## 📁 Project structure

```
jarvis/
├── server/
│   ├── index.js        # Express + WebSocket orchestration (agentic loop, auth, RAG wiring)
│   ├── llm.js          # Unified LLM service: chatStream + agentStream (Claude & Groq)
│   ├── tools.js        # Agent tool registry + dispatcher
│   ├── rag.js          # Document RAG (chunk / embed / vector search)
│   ├── memory.js       # Persistent memory, profile, tasks, notes, follow-ups (SQLite)
│   ├── briefing.js     # Proactive suggestions + morning briefing
│   ├── tts.js          # Edge TTS with clause-level streaming
│   ├── calendar.js · email.js · search.js · news.js · smarthome.js · music.js · phone.js
│   ├── auth.js · privacy.js · push.js · backup.js · monitor.js · reminders.js · mood.js
│   └── personality.json
├── client/             # React + TypeScript + Tailwind (Vite) → builds into /public
│   └── src/
│       ├── App.tsx · stores/ · api/ · components/
│       └── components/documents/DocumentsView.tsx   # RAG UI
├── public/             # Built frontend (generated)
├── Dockerfile · railway.toml · .env.example
└── README.md
```

---

## 🔧 Customization

- **Personality** — edit `server/personality.json` (system prompt, name, style).
- **LLM model** — edit `server/llm.js` (`this.model` / `this.fastModel`).
- **Add a tool** — add a definition + handler in `server/tools.js`; it's offered to
  the model automatically (gate it on an integration's readiness if needed).

---

Built with 🧠 by Varada Sai Datta Vishnu
