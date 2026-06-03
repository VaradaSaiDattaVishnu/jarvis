# JARVIS — Rebuild Progress & Resume Plan

> Working doc for the "fix all bugs + add 3 AI features + deploy" effort.
> **Status: feature-complete. Server + client built & verified. Ready to ship.**

## Decisions (locked)
- **Three AI features built:** (1) agentic tool-calling loop, (2) voice RAG over uploaded documents, (3) proactive AI agent.
- **Deploy:** new GitHub repo under `VaradaSaiDattaVishnu` (gh authed, full repo scope) + Railway-ready (Dockerfile + railway.toml).
- **LLM brain:** Groq default (real key in `.env`). Adding a real `ANTHROPIC_API_KEY` auto-upgrades to Claude (`claude-sonnet-4-6`).

---

## DONE — Server (all syntax-checked; boots clean; agentic loop + RAG verified live)

### New / rewritten
- **`llm.js`** — `chatStream` + `agentStream` (multi-turn tool loop) for Claude (streamed tool calls) and Groq (NON-streamed per turn — Groq's streamed tool calls 400). Added a recovery shim: Groq/Llama sometimes emit `<function=name{json}</function>` text that Groq rejects with `tool_use_failed`; `parseLlamaToolCalls`/`extractFailedGeneration` recover it. 429 → fast-model fallback.
- **`tools.js`** — ~20 tools, exposed by integration readiness; `get_integration_status` for honest capability answers.
- **`rag.js`** — documents + doc_chunks tables; chunk→embed→cosine search w/ keyword fallback; `/api/documents` routes (mutations auth-gated). **Verified end-to-end** (indexed a doc, semantic search returned it; agent `search_documents` cited the source).
- **`index.js`** — full rewrite: memory-first init + `app_config`→`process.env` hydration; `calendar.onAuthChange=()=>email.reinit()`; email + rag routes registered unconditionally; **auth gating** (guards mounted BEFORE protected routes); **proactive services instantiated/registered BEFORE the SPA catch-all** (fixed a latent shadowing bug — GET /api/followups & /api/briefing/* were 404ing); WS handler uses `agentStream`+`buildTools` (regex intent detection removed); interrupt/abort fixed (identity-guarded finally, abort-aware completion so no double-save/late response_complete); privacy fast-path awaits TTS; `set_voice` allowlist; tool events to client; privacy cleanup on disconnect; `/api/proactive/suggestions`; brave key name aligned to `BRAVE_SEARCH_API_KEY`; added `/api/notes/export`.
- **`briefing.js`** — `generateProactiveInsights()` (Feature 3 engine).
- Leaf fixes: `followup.js` (#11 local-time check_after, #12 ack-on-WS-delivery), `phone.js` (#10 Twilio sig validation + trust proxy), `backup.js` (DATA_DIR), deleted dead `groq.js`.

### Verified live (on PORT=3999, Groq)
- Boot clean; `/api/health`, `/api/admin/setup-status`, `/api/documents`, `/api/followups`, `/api/briefing/config` all OK.
- Agentic: `set_reminder`, `search_documents` (cited), `get_current_time`, `get_integration_status` all fire + narrate.
- Barge-in: interrupt saves partial + sends `interrupted`; follow-up turn accepted (lock releases).
- `set_voice` allowlist: valid accepted, `"evil; rm -rf /"` rejected.
- (Only "failures" seen were Groq free-tier 429 TPM limits from rapid test barrage — handled by fast-model fallback.)

## DONE — Client (tsc -b clean; vite build succeeds → /public; SPA serves)
- `types/index.ts` aligned to real payloads (WSStats, provider, tool/auth_* messages, HealthData string uptime + *LatencyMs + errorRate string, Document/DocSearchResult/ProactiveSuggestion/FollowUp).
- `api/client.ts` x-session-id; `api/endpoints.ts` playMusic body (#9), followups {pending,due} (#45), + document/proactive/auth endpoints; `api/websocket.ts` intentionalClose (#30); `api/push.ts` (sw register + push subscribe, #33).
- stores: app (stats/provider/authenticated), chat (toolActivity), monitor (→/api/health), notes (race guard #51), tasks (return calendarSync #49).
- `App.tsx` setup gating, provider/auth wiring, follow_up/tool/auth_* cases, #47 speaking-from-audio-only; `main.tsx` SW register.
- New: `components/documents/DocumentsView.tsx` (Feature 2 UI), `components/auth/PinGate.tsx`. `DashboardView` health-mapping fix + uncapped task count (#32) + Proactive panel (Feature 3). `MessageList` empty state (#50) + tool chip. `SetupWizard` voice persist (#29/#31). `NotesView` debounce. Sidebar + MobileNav Documents nav.

## DONE — Deploy
- `Dockerfile`: npm ci both stages (#34), dropped redundant client/public copy (#53), EXPOSE 3000 (#54), ENV DATA_DIR=/data.
- `railway.toml`: documents the `/data` volume + recommended vars.
- `.gitignore`: + `.jarvis_vapid.json`, `*.db-shm`, `*.db-wal`, `.DS_Store`. `.env.example` refreshed (Anthropic optional, DATA_DIR). README rewritten for 3 features + agentic arch.
- package-lock.json present in root + client (npm ci works). gh authed as VaradaSaiDattaVishnu.
- NOTE: Docker not installed locally — image build must be verified on the deploy host.

## REVIEW FINDINGS — all 15 confirmed issues fixed (adversarial review workflow)
- llm.js: Claude safety-net for budget-exhausted tool chains (#1); Groq recovery arg coercion (Python-literal/single-quote → JSON) + brace-balanced multi-call parser (#2,#12); 429 fast-model fallback now also recovers tool_use_failed (#3); Groq safety-net yields a deterministic fallback on empty content (#7).
- tools.js: required-arg validation in execute() so malformed/empty calls get a correctable error, not a silent no-op.
- phone.js: _twilioGuard now fails CLOSED (403) when it can't verify a signature (#5); _initClient/reload() + readiness 503 gate so routes mount unconditionally and light up after runtime Twilio setup (#4).
- index.js: phone routes registered unconditionally + phone.reload() on Twilio config (#4); set_voice persists JARVIS_VOICE to app_config (durable, #15); privacy fast-path emits 'thinking' first so the client resets its audio cursor (#6).
- followup.js: delivered-tracking map + 6h ack grace → push fallback so an un-acked WS follow-up can't loop forever (#8).
- App.tsx: setAuthenticated(!authRequired) on every (re)connect (#9); interrupted → mode-aware coreState (#14); reset audio cursor on drained response_complete (#6 defense).
- DocumentsView: debounce + seq race guard (#10). PinGate: timer cleanup + ws.connected guard (#11). endpoints.ts: updateFollowUpConfig snake_case (#13).
- Re-verified: server boots, agentic loop fires (set_reminder), `tsc -b` + `vite build` clean.

## REMAINING
- `git init` → commit → `gh repo create` → push. (git initialized; secret-leak dry-run passed.)
- (Optional) verify `docker build` on a host with Docker (not installed locally).

## Gotchas
- Port 3000 is taken locally by an unrelated "CUBE" Vite app — test JARVIS on PORT=3999.
- Groq free tier = 12k TPM; rapid testing trips 429 (handled via fast-model fallback). Background extraction fires ~7 LLM calls/turn.
- macOS has no `timeout` — use background `node ... &` + sleep + `lsof -ti:PORT | xargs kill`.
