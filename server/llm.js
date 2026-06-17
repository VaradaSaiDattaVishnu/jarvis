// Unified LLM service — built on LangChain.js (ChatAnthropic + ChatGroq).
//
// Auto-detects the provider from which API key is present: a real
// ANTHROPIC_API_KEY → Claude (claude-sonnet-4-6), otherwise GROQ_API_KEY → Groq
// (llama-3.3-70b-versatile). Both are LangChain chat models, so tool binding,
// streaming, and structured output go through ONE normalized interface.
//
// Why LangChain here: the chat-model abstraction (`bindTools`, `.stream()`,
// `.withStructuredOutput()`) gives us provider-portable tool calling and typed
// structured extraction for free — the parts that were the most hand-rolled and
// brittle before. We keep ONE thing custom on purpose (see _groqAgentStep): the
// recovery shim for Llama's text-format tool calls, because Groq/Llama still
// occasionally emit `<function=name{json}</function>` as plain text instead of
// the native tool-call channel, and no framework normalizes that away.
//
// Public surface (kept stable so server/index.js and the other services that
// call us don't change):
//   chatStream(system, messages, signal)              → async generator of text
//   chat(system, messages, { useMainModel })          → Promise<string>
//   agentStream(system, messages, tools, exec, signal)→ async generator of events
//   extractStructured(system, text, zodSchema, opts)  → Promise<object>  (NEW)
//
// agentStream yields typed events so the orchestrator can speak the prose AND
// surface tool activity to the UI:
//   { type: 'text', text }                  — a chunk of assistant prose (speak it)
//   { type: 'tool_start', name, input }     — model decided to call a tool
//   { type: 'tool_result', name, result }   — tool finished (result is a string)

const { ChatAnthropic } = require('@langchain/anthropic');
const { ChatGroq } = require('@langchain/groq');
const {
  SystemMessage, HumanMessage, AIMessage, ToolMessage,
} = require('@langchain/core/messages');

const PLACEHOLDER = /^(your[-_]|sk-ant-xxx|xxx|changeme|placeholder)/i;

function isRealKey(k) {
  return typeof k === 'string' && k.trim().length > 10 && !PLACEHOLDER.test(k.trim()) && !k.includes('-here');
}

// ─── Llama text-format tool-call recovery (Groq only) ───────────────────
// Groq/Llama sometimes emit tool calls as TEXT in the functionary format
// (`<function=name{json}</function>`) instead of the native tool_calls channel.
// Groq's server may then reject the generation with code `tool_use_failed`,
// handing back the raw text in `failed_generation`; other times the text just
// comes through as the message content. These helpers recover the intended call
// so the agent loop keeps working instead of hard-failing the turn.
function extractFailedGeneration(error) {
  return error?.error?.failed_generation
    || error?.error?.error?.failed_generation
    || error?.lc_error_code?.failed_generation
    || (() => {
      const msg = error?.message || '';
      const idx = msg.indexOf('{');
      if (idx < 0) return null;
      try { return JSON.parse(msg.slice(idx)).error?.failed_generation || null; } catch { return null; }
    })();
}

function isToolUseFailed(error) {
  const code = error?.error?.code || error?.error?.error?.code;
  return code === 'tool_use_failed' || /failed to call a function|tool_use_failed/i.test(error?.message || '');
}

function isRateLimited(error) {
  return error?.status === 429 || error?.error?.status === 429 || /\b429\b|rate.?limit/i.test(error?.message || '');
}

// Extract a brace-balanced JSON object starting at the '{' at startIdx (handles
// nested braces and quoted strings). Returns the substring or null.
function extractBalancedJson(text, startIdx) {
  let depth = 0, inStr = false, quote = '', esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
    } else if (c === '"' || c === "'") { inStr = true; quote = c; }
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
  }
  return null;
}

// Coerce a JS/Python-ish object literal into strict JSON (Llama emits single
// quotes and True/False/None). Returns a parseable JSON string, or null.
function coerceToJsonString(raw) {
  if (!raw) return null;
  try { JSON.parse(raw); return raw; } catch { /* attempt repair */ }
  const repaired = raw
    .replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
    .replace(/'/g, '"');
  try { JSON.parse(repaired); return repaired; } catch { return null; }
}

function parseLlamaToolCalls(text) {
  const calls = [];
  if (!text) return calls;
  const re = /<function=([a-zA-Z0-9_]+)>?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const braceStart = m.index + m[0].length - 1; // index of the '{'
    const json = extractBalancedJson(text, braceStart);
    if (json) {
      calls.push({ name: m[1], args: json });
      re.lastIndex = braceStart + json.length;
    }
  }
  return calls;
}

// ─── Small helpers ───────────────────────────────────────
// Pull plain text out of a LangChain message/chunk `content`, which can be a
// string (Groq, Claude text) or an array of content blocks (Claude tool turns).
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (typeof b === 'string' ? b : (b?.type === 'text' ? b.text : ''))).join('');
  }
  return '';
}

// Convert our { role, content } history into LangChain message objects.
function toLcMessages(system, messages) {
  const out = [];
  if (system) out.push(new SystemMessage(system));
  for (const m of messages || []) {
    const content = typeof m.content === 'string' ? m.content : textOf(m.content);
    if (m.role === 'assistant') out.push(new AIMessage(content));
    else out.push(new HumanMessage(content)); // treat anything else as user input
  }
  return out;
}

class LLMService {
  constructor({ anthropicKey, groqKey }) {
    if (isRealKey(anthropicKey)) {
      this.provider = 'claude';
      this.model = 'claude-sonnet-4-6';
      this.fastModel = 'claude-haiku-4-5-20251001';
      const key = anthropicKey.trim();
      this._make = (modelId, maxTokens) => new ChatAnthropic({ apiKey: key, model: modelId, maxTokens, maxRetries: 2 });
    } else if (isRealKey(groqKey)) {
      this.provider = 'groq';
      this.model = 'llama-3.3-70b-versatile';
      this.fastModel = 'llama-3.1-8b-instant';
      const key = groqKey.trim();
      this._make = (modelId, maxTokens) => new ChatGroq({ apiKey: key, model: modelId, maxTokens, temperature: 0.7, maxRetries: 2 });
    } else {
      throw new Error('No API key found. Set ANTHROPIC_API_KEY or GROQ_API_KEY in .env');
    }
    this.main = this._make(this.model, 2048);
    this.fast = this._make(this.fastModel, 1024);
    console.log(`🧠 LLM Provider: ${this.provider} (${this.model}) via LangChain`);
  }

  get displayName() {
    return this.provider === 'claude' ? 'Claude' : 'Groq';
  }

  // ─── Plain streaming chat (no tools) ────────────────────
  async *chatStream(system, messages, signal = null) {
    const convo = toLcMessages(system, messages);
    try {
      yield* this._streamText(this.main, convo, signal);
    } catch (error) {
      if (isRateLimited(error)) {
        yield* this._streamText(this.fast, convo, signal); // 8b/haiku fallback
      } else {
        throw error;
      }
    }
  }

  async *_streamText(model, convo, signal) {
    const stream = await model.stream(convo, signal ? { signal } : undefined);
    for await (const chunk of stream) {
      if (signal?.aborted) break;
      const t = textOf(chunk.content);
      if (t) yield t;
    }
  }

  // ─── Agentic tool-calling loop ──────────────────────────
  // tools:   [{ name, description, input_schema (JSON Schema) }]  (from tools.js)
  // execute: async (name, input) => string                       (the dispatcher)
  async *agentStream(system, messages, tools, execute, signal = null) {
    if (!tools || tools.length === 0) {
      for await (const text of this.chatStream(system, messages, signal)) {
        yield { type: 'text', text };
      }
      return;
    }

    // LangChain accepts JSON-schema tool defs as { name, description, schema },
    // so the conditional tool registry in tools.js feeds straight in.
    const lcTools = tools.map(t => ({ name: t.name, description: t.description, schema: t.input_schema }));
    const mainWithTools = this.main.bindTools(lcTools);
    const fastWithTools = this.fast.bindTools(lcTools);
    const convo = toLcMessages(system, messages);
    const MAX_ITERS = 6;
    let nudged = false; // we only nudge an empty no-op turn once

    for (let iter = 0; iter < MAX_ITERS; iter++) {
      if (signal?.aborted) return;

      // ── Get the assistant turn ────────────────────────────
      // Claude: stream so prose reaches TTS as it's generated.
      // Groq:   invoke (non-streaming) — Groq's streamed tool-call mode is
      //         unreliable (it 400s mid-stream), and Groq is fast enough that a
      //         per-turn non-streamed call is imperceptible and rock-solid.
      let assistant; // AIMessage with .content and .tool_calls
      if (this.provider === 'claude') {
        let gathered;
        const stream = await mainWithTools.stream(convo, signal ? { signal } : undefined);
        for await (const chunk of stream) {
          if (signal?.aborted) return;
          const t = textOf(chunk.content);
          if (t) yield { type: 'text', text: t };
          gathered = gathered === undefined ? chunk : gathered.concat(chunk);
        }
        assistant = gathered;
      } else {
        assistant = await this._groqAgentStep(mainWithTools, fastWithTools, convo, signal, iter);
        const t = textOf(assistant.content);
        if (t) yield { type: 'text', text: t };
      }

      const toolCalls = (assistant && assistant.tool_calls) || [];
      if (toolCalls.length === 0) {
        // Final answer (text already streamed for Claude / yielded for Groq).
        if (textOf(assistant && assistant.content).trim()) return;
        // Empty no-op turn — Groq/Llama occasionally returns neither text nor a
        // tool call, especially mid-conversation. Nudge once to unstick it
        // (tools stay available); if still empty, fall through to the forced
        // reply below so the user is never met with silence.
        if (!nudged && iter < MAX_ITERS - 1) {
          nudged = true;
          convo.push(new HumanMessage('(You did not reply. Please answer my previous message now — call a tool first if you need information to do so.)'));
          continue;
        }
        break;
      }

      // Re-add the assistant turn as text + tool_calls only (never the raw
      // streamed content array — that would double-encode the tool_use blocks).
      convo.push(new AIMessage({ content: textOf(assistant.content), tool_calls: toolCalls }));

      for (const tc of toolCalls) {
        if (signal?.aborted) return;
        yield { type: 'tool_start', name: tc.name, input: tc.args };
        let result;
        try { result = await execute(tc.name, tc.args); }
        catch (e) { result = `Error: ${e.message}`; }
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
        yield { type: 'tool_result', name: tc.name, result: text };
        convo.push(new ToolMessage({ content: text || '(no output)', tool_call_id: tc.id, name: tc.name }));
      }
    }

    // Exhausted the tool budget without a closing answer — force one final
    // tool-less reply so the user always hears a response.
    if (signal?.aborted) return;
    const finalModel = this.provider === 'claude' ? this.main : this.fast;
    const finalResp = await finalModel.invoke(convo, signal ? { signal } : undefined);
    yield { type: 'text', text: textOf(finalResp.content) || 'Sorry, I ran out of steps on that — could you try rephrasing?' };
  }

  // One Groq agent step: invoke with tools, with a 429→fast fallback and the
  // Llama text-format tool-call recovery shim (the one piece LangChain can't do
  // for us). Always returns an AIMessage that carries .tool_calls when present.
  async _groqAgentStep(mainWithTools, fastWithTools, convo, signal, iter) {
    const opts = signal ? { signal } : undefined;
    let resp;
    try {
      resp = await mainWithTools.invoke(convo, opts);
    } catch (error) {
      if (isToolUseFailed(error)) return this._recoverFromError(error, iter);
      if (isRateLimited(error)) {
        try {
          resp = await fastWithTools.invoke(convo, opts);
        } catch (e2) {
          if (isToolUseFailed(e2)) return this._recoverFromError(e2, iter);
          throw e2;
        }
      } else {
        throw error;
      }
    }
    // Native channel was empty but the model emitted text-format calls inline.
    if ((!resp.tool_calls || resp.tool_calls.length === 0)
      && typeof resp.content === 'string' && resp.content.includes('<function=')) {
      const recovered = this._recoverFromText(resp.content, iter);
      if (recovered) return recovered;
    }
    return resp;
  }

  _recoverFromError(error, iter) {
    return this._recoverFromText(extractFailedGeneration(error), iter)
      || new AIMessage('Sorry, I had trouble with that — could you rephrase?');
  }

  // Turn Llama's `<function=…>` text into a proper AIMessage with tool_calls
  // (args parsed to objects, as LangChain expects). Returns null if nothing
  // usable was found.
  _recoverFromText(text, iter) {
    if (!text) return null;
    const calls = parseLlamaToolCalls(text)
      .map((c, i) => {
        const json = coerceToJsonString(c.args);
        if (!json) return null;
        let args;
        try { args = JSON.parse(json); } catch { return null; }
        return { id: `gtc_${iter}_${i}`, name: c.name, args, type: 'tool_call' };
      })
      .filter(Boolean);
    if (calls.length) return new AIMessage({ content: '', tool_calls: calls });
    const clean = String(text).replace(/<\/?function[^>]*>/g, '').trim();
    return clean ? new AIMessage(clean) : null;
  }

  // ─── Non-streaming chat (background tasks) ──────────────
  async chat(system, messages, { useMainModel = false } = {}) {
    const model = useMainModel ? this.main : this.fast;
    const resp = await model.invoke(toLcMessages(system, messages));
    return textOf(resp.content) || '';
  }

  // ─── Structured extraction (one typed call, replaces N parsing calls) ───
  // Pass a Zod schema; LangChain constrains the model to it via tool calling and
  // returns the parsed object. Used by the consolidated memory extractor.
  async extractStructured(system, userText, zodSchema, { useMainModel = true } = {}) {
    const model = useMainModel ? this.main : this.fast;
    const structured = model.withStructuredOutput(zodSchema);
    return structured.invoke([new SystemMessage(system), new HumanMessage(userText)]);
  }
}

module.exports = LLMService;
