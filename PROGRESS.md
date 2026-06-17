# JARVIS — Rebuild Progress & Resume Plan

> Working doc for the "fix all bugs + add 3 AI features + deploy" effort.
> **Status: feature-complete. Server + client built & verified. Ready to ship.**

---

## 2026-06-17 — LangChain.js rebuild + critical bug fixes

After the previous rebuild, four regressions made the app feel broken. Root-caused
and fixed, and the LLM + RAG layers were rebuilt on **LangChain.js** (0.3.x, Node-18
compatible) for a cleaner, provider-portable core.

**Root-caused & fixed**
1. **Voice "half one accent, half garbled"** — `tts.js` `detectLanguage()` ran
   per-clause and its Latin-script word lists matched everyday English ("do",
   "as", "per", "la"), so clauses were spoken with a Portuguese/Italian neural
   voice. Now detects **only non-Latin scripts, dominance-gated (≥30%)**; Latin
   text always keeps the configured voice. Verified across en/hi/ja/zh + mixed.
2. **RAG "you haven't uploaded any" / can't summarize / 10-min hang** — uploads
   could store **NULL embeddings** (model not ready) → permanently invisible; and
   top-k search can't summarize a whole file. Rebuilt RAG on LangChain
   (`RecursiveCharacterTextSplitter` + a `MiniLMEmbeddings` adapter over the
   cached @xenova model + `MemoryVectorStore` hydrated from SQLite). Always embeds;
   backfills legacy NULLs on boot. Added **`list_documents` + `read_document`**
   tools so "summarize my doc" works. Verified: index → semantic Q&A → grounded
   whole-doc summary.
3. **Latency ("razor fast → slow")** — every turn fired **8 background LLM calls**
   (memories/profile/mood/relationships/tasks/preferences/entities/follow-ups),
   tripping Groq's 12k-TPM free tier (429 → next turn slow) and ~8×-ing Claude
   cost. Collapsed into **ONE** `withStructuredOutput` call
   (`memory.extractAndStore`, Zod schema), fanned into the existing setters.
   Verified: one ~1.5s call captured name/job/interests/task/mood/entities/follow-up.
4. **STT "can't understand my inputs"** — `ChatInput.tsx` mic dropped results
   while speaking and churned stop/start. Rebuilt the speaking↔listening state
   machine (single `runningRef` guard, clean resume, no double-`start()`).

**LangChain migration (Hybrid)**
- `llm.js` → `ChatAnthropic` + `ChatGroq`; unified `.bindTools()` + `.stream()`
  agent loop (Claude streams; Groq invokes — its streamed tool calls 400);
  `.withStructuredOutput()` for extraction. **Kept custom (justified in code):**
  the WS streaming orchestration, edge-TTS, SQLite memory, and the Groq/Llama
  text-format tool-call **recovery shim** (no framework replicates it). Added an
  **empty-turn safety net** (nudge-and-retry, then forced reply) so Llama's
  occasional no-op turns never leave the user with silence.
- Model IDs unchanged: `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`.
- Deps added: `@langchain/core@^0.3`, `@langchain/anthropic@^0.3`,
  `@langchain/groq@^0.2`, `@langchain/textsplitters@^0.1`, `langchain@^0.3`, `zod`.
- Superseded (now dead, safe to delete later): the per-field extractors
  `extractMemoriesFromExchange/updateUserModel/extractRelationships/extractTasks/extractPreferences/extractEntities`,
  `mood.analyzeMood`, `followUp.detectFollowUpOpportunity`.

**Verified live (PORT=3999, Groq, throwaway DB):** boot clean; client `tsc -b`
+ vite build clean; chat + `get_current_time` tool (TTFB ~1s, audio OK); RAG
summarize after prior history (grounded, non-empty); single consolidated
extraction in logs. (Only "failure": Groq free-tier 429 from rapid test volume —
now surfaced as a friendly rate-limit message.)

---

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
