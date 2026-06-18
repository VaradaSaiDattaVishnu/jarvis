# JARVIS — Agentic AI Voice Assistant

A voice-first personal assistant built on a **LangChain v1 tool-calling agent**. You speak
to it; an LLM reasons over a set of real tools (web search, weather, currency, and more),
answers questions about your own documents via RAG with citations, remembers facts across
sessions, and replies out loud.

This is a learning-grade but production-deployable implementation. The priority is
**readable code over clever code** — every architectural decision is made deliberately and
documented.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  React + Vite frontend — mic button + chat, minimal UI    │
│    record → /transcribe (Groq Whisper) → /chat → 🔊 speak  │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP (Vite proxy in dev; same origin in prod)
┌───────────────────────────▼──────────────────────────────┐
│  Node + TypeScript backend (Express)                       │
│   ┌──────────────────────────────────────────────────┐    │
│   │  Agent core (LangChain createAgent): tool loop     │    │
│   │    LLM (Claude) ⇄ tools ⇄ memory ⇄ RAG retriever   │    │
│   └──────────────────────────────────────────────────┘    │
│   RAG:    local MiniLM embeddings + SQLite, cited answers  │
│   Memory: conversation checkpointer + durable facts        │
│   Voice:  Groq Whisper (speech-to-text) at /transcribe     │
│   Store:  SQLite                                           │
└────────────────────────────────────────────────────────────┘
```

## Tech stack

- **Backend:** Node.js (≥20) + TypeScript + Express
- **Agent:** LangChain v1 — `createAgent` tool-calling loop (LangGraph under the hood)
- **LLM:** Claude Haiku 4.5 (reasoning) + Groq Whisper (speech-to-text)
- **RAG:** local MiniLM embeddings (Transformers.js) + SQLite vector store, cited answers
- **Memory:** in-memory conversation checkpointer + SQLite long-term facts
- **Frontend:** React + Vite (intentionally minimal); browser speech synthesis for replies
- **Storage:** SQLite (better-sqlite3)

## What JARVIS can do (tools)

`get_current_time` · `calculator` · `get_weather` · `convert_units` · `convert_currency` ·
`search` (Tavily) · `document_search` (RAG, cited) · `remember_fact` · `recall_facts`

## Roadmap

- [x] **①  Skeleton** — server bootstrap, health check, tooling
- [x] **②  Agent core** — LangChain tool-calling loop (`POST /chat`)
- [x] **③  Tools** — real + local tools the agent can call
- [x] **④  RAG** — local MiniLM embeddings + SQLite retrieval, cited answers
- [x] **⑤  Memory** — conversation history + durable facts
- [x] **⑥  Voice** — Groq Whisper speech-to-text + spoken replies
- [x] **⑦  Frontend** — React mic + chat UI
- [x] **⑧  Deploy** — one Node service serves the API + built frontend (any Node host)

## Run the full app (local)

```bash
# 1) Backend  (terminal 1)
cd server
cp .env.example .env        # add ANTHROPIC_API_KEY (required); GROQ_API_KEY enables voice
npm install
npm run dev                 # http://localhost:3001

# 2) Frontend (terminal 2)
cd web
npm install
npm run dev                 # http://localhost:5173  (proxies API to :3001)
```

Open **http://localhost:5173**, then type or tap the mic. Voice input needs `GROQ_API_KEY`;
text chat and spoken replies work regardless (replies use the browser's speech synthesis).

## Knowledge base (RAG)

Drop `.txt`/`.md` files into `server/data/documents/`, then run `npm run ingest` (from
`server/`). Now ask about them — the agent calls `document_search` and answers with the
source cited.

## Deploy

The app deploys as **one Node service** that builds the React frontend and serves it on the
same origin as the API (no CORS, one URL) — so it runs on any Node host:

- **Build:** `npm run build` (root) → installs deps and builds `web/` into `web/dist`
- **Start:** `npm start` (root) → runs the server, which serves `web/dist` + the API
- **Env:** `ANTHROPIC_API_KEY` (required); `GROQ_API_KEY` (voice) and `TAVILY_API_KEY`
  (search) optional.
- **Runtime:** Node ≥20 (see `.nvmrc`); the server listens on `process.env.PORT`.

> **Storage note:** SQLite lives on the instance's local disk. On an ephemeral filesystem it
> resets on redeploy/restart (re-run `npm run ingest`; remembered facts reset too). Attach a
> persistent volume for durable storage.
