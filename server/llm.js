// Unified LLM service — supports Claude (preferred) and Groq (free fallback)
// Auto-detects based on which API key is available in .env.
//
// Capabilities:
//   chatStream(system, messages, signal)            → plain streaming text
//   chat(system, messages, opts)                    → non-streaming (background tasks)
//   agentStream(system, messages, tools, exec, sig) → multi-turn function-calling loop
//
// agentStream yields a stream of typed events so the orchestrator can both speak
// the assistant's text AND surface tool activity to the UI:
//   { type: 'text', text }                  — a chunk of assistant prose (speak it)
//   { type: 'tool_start', name, input }     — model decided to call a tool
//   { type: 'tool_result', name, result }   — tool finished (result is a string)

const PLACEHOLDER = /^(your[-_]|sk-ant-xxx|xxx|changeme|placeholder)/i;

function isRealKey(k) {
  return typeof k === 'string' && k.trim().length > 10 && !PLACEHOLDER.test(k.trim()) && !k.includes('-here');
}

// Groq/Llama sometimes emit tool calls as TEXT in the functionary format
// (`<function=name{json}</function>`) instead of the native tool_calls channel.
// Groq's server then rejects the generation with code `tool_use_failed`, handing
// back the raw text in `failed_generation`. These helpers recover the intended
// call so the agent loop keeps working instead of hard-failing.
function extractFailedGeneration(error) {
  return error?.error?.failed_generation
    || error?.error?.error?.failed_generation
    || (() => {
      const msg = error?.message || '';
      const idx = msg.indexOf('{');
      if (idx < 0) return null;
      try { return JSON.parse(msg.slice(idx)).error?.failed_generation || null; } catch { return null; }
    })();
}

function isToolUseFailed(error) {
  const code = error?.error?.code || error?.error?.error?.code;
  return code === 'tool_use_failed' || /failed to call a function/i.test(error?.message || '');
}

// Extract a brace-balanced JSON object starting at the '{' at startIdx, so we
// don't over-capture trailing prose and we stop at the matching close brace
// (handles nested braces and quoted strings). Returns the substring or null.
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

// Best-effort: coerce a JS/Python-ish object literal into a strict-JSON string.
// Llama's functionary format often emits single quotes and True/False/None.
// Returns a parseable JSON string, or null if it still can't be salvaged.
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
  // Find each <function=name ...{ and balance-match the JSON object — robust to
  // missing </function> tags, multiple calls, nested braces and trailing prose.
  const re = /<function=([a-zA-Z0-9_]+)>?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const braceStart = m.index + m[0].length - 1; // index of the '{'
    const json = extractBalancedJson(text, braceStart);
    if (json) {
      calls.push({ name: m[1], args: json });
      re.lastIndex = braceStart + json.length; // resume scanning after this call
    }
  }
  return calls;
}

// Build a synthetic Groq response carrying recovered tool calls (or recovered
// prose) from a tool_use_failed error. Shared by the primary + 429-fallback paths.
function recoverFromToolFailure(error, iter) {
  const fg = extractFailedGeneration(error);
  const usable = parseLlamaToolCalls(fg)
    .map(c => ({ name: c.name, args: coerceToJsonString(c.args) }))
    .filter(c => c.args !== null);
  if (usable.length) {
    return { choices: [{ message: {
      content: null,
      tool_calls: usable.map((c, i) => ({ id: `gtc_${iter}_${i}`, type: 'function', function: { name: c.name, arguments: c.args } })),
    } }] };
  }
  const clean = String(fg || '').replace(/<\/?function[^>]*>/g, '').trim();
  return { choices: [{ message: { content: clean || 'Sorry, I had trouble with that — could you rephrase?' } }] };
}

class LLMService {
  constructor({ anthropicKey, groqKey }) {
    if (isRealKey(anthropicKey)) {
      this.provider = 'claude';
      const Anthropic = require('@anthropic-ai/sdk');
      this.client = new Anthropic({ apiKey: anthropicKey.trim() });
      this.model = 'claude-sonnet-4-6';
      this.fastModel = 'claude-haiku-4-5-20251001';
    } else if (isRealKey(groqKey)) {
      this.provider = 'groq';
      const Groq = require('groq-sdk');
      this.client = new Groq({ apiKey: groqKey.trim() });
      this.model = 'llama-3.3-70b-versatile';
      this.fastModel = 'llama-3.1-8b-instant';
    } else {
      throw new Error('No API key found. Set ANTHROPIC_API_KEY or GROQ_API_KEY in .env');
    }
    console.log(`🧠 LLM Provider: ${this.provider} (${this.model})`);
  }

  get displayName() {
    return this.provider === 'claude' ? 'Claude' : 'Groq';
  }

  // ─── Plain streaming chat ───────────────────────────────
  async *chatStream(system, messages, signal = null) {
    if (this.provider === 'claude') {
      yield* this._claudeStream(system, messages, signal);
    } else {
      yield* this._groqStream(system, messages, signal);
    }
  }

  async *_claudeStream(system, messages, signal) {
    const stream = await this.client.messages.create(
      { model: this.model, max_tokens: 2048, system, messages, stream: true },
      signal ? { signal } : undefined,
    );
    for await (const event of stream) {
      if (signal?.aborted) break;
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  async *_groqStream(system, messages, signal) {
    const groqMessages = [{ role: 'system', content: system }, ...messages];
    const run = (model, maxTokens) => this.client.chat.completions.create(
      { model, messages: groqMessages, stream: true, temperature: 0.8, max_tokens: maxTokens },
      signal ? { signal } : undefined,
    );
    try {
      const stream = await run(this.model, 2048);
      for await (const chunk of stream) {
        if (signal?.aborted) break;
        const content = chunk.choices[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (error) {
      if (error.status === 429) {
        console.log('⚡ Rate limited, falling back to fast model');
        const stream = await run(this.fastModel, 1024);
        for await (const chunk of stream) {
          if (signal?.aborted) break;
          const content = chunk.choices[0]?.delta?.content;
          if (content) yield content;
        }
      } else {
        throw error;
      }
    }
  }

  // ─── Agentic tool-calling loop ──────────────────────────
  // tools: [{ name, description, input_schema (JSON Schema) }]
  // execute: async (name, input) => string  (tool result to feed back to the model)
  async *agentStream(system, messages, tools, execute, signal = null) {
    if (!tools || tools.length === 0) {
      for await (const text of this.chatStream(system, messages, signal)) {
        yield { type: 'text', text };
      }
      return;
    }
    if (this.provider === 'claude') {
      yield* this._claudeAgent(system, messages, tools, execute, signal);
    } else {
      yield* this._groqAgent(system, messages, tools, execute, signal);
    }
  }

  async *_claudeAgent(system, messages, tools, execute, signal) {
    const anthropicTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
    const convo = messages.map(m => ({ role: m.role, content: m.content }));
    const MAX_ITERS = 6;

    for (let iter = 0; iter < MAX_ITERS; iter++) {
      if (signal?.aborted) return;

      const stream = await this.client.messages.create(
        { model: this.model, max_tokens: 2048, system, messages: convo, tools: anthropicTools, stream: true },
        signal ? { signal } : undefined,
      );

      const assistantBlocks = [];
      let curText = null;
      let curTool = null;
      const toolUses = [];

      for await (const event of stream) {
        if (signal?.aborted) return;
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'text') {
            curText = { type: 'text', text: '' };
          } else if (event.content_block.type === 'tool_use') {
            curTool = { id: event.content_block.id, name: event.content_block.name, _input: '' };
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            if (curText) curText.text += event.delta.text;
            yield { type: 'text', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            if (curTool) curTool._input += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (curText) { assistantBlocks.push(curText); curText = null; }
          if (curTool) {
            let input = {};
            try { input = curTool._input ? JSON.parse(curTool._input) : {}; } catch { /* leave {} */ }
            assistantBlocks.push({ type: 'tool_use', id: curTool.id, name: curTool.name, input });
            toolUses.push({ id: curTool.id, name: curTool.name, input });
            curTool = null;
          }
        }
      }

      if (toolUses.length === 0) return; // final text already streamed

      convo.push({ role: 'assistant', content: assistantBlocks });
      const toolResults = [];
      for (const tu of toolUses) {
        if (signal?.aborted) return;
        yield { type: 'tool_start', name: tu.name, input: tu.input };
        let result;
        try { result = await execute(tu.name, tu.input); }
        catch (e) { result = `Error: ${e.message}`; }
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
        yield { type: 'tool_result', name: tu.name, result: text };
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: text || '(no output)' });
      }
      convo.push({ role: 'user', content: toolResults });
    }

    // Exhausted the tool budget without a closing answer — force one final
    // tool-less reply so the user always hears a response (mirrors the Groq net).
    if (signal?.aborted) return;
    const finalResp = await this.client.messages.create(
      { model: this.model, max_tokens: 1024, system, messages: convo },
      signal ? { signal } : undefined,
    );
    const finalText = finalResp.content.filter(b => b.type === 'text').map(b => b.text).join('');
    yield { type: 'text', text: finalText || 'Sorry, I ran out of steps on that — could you try rephrasing?' };
  }

  // NOTE: Groq's STREAMING tool-call mode is unreliable — it frequently 400s with
  // "Failed to call a function" when Llama emits a tool call mid-stream. Groq is
  // fast enough (~hundreds of tok/s) that running each agent turn non-streaming is
  // imperceptible, and it's rock-solid. The streamed tool loop lives on the Claude
  // path, where streamed tool calls work reliably.
  async *_groqAgent(system, messages, tools, execute, signal) {
    const openaiTools = tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
    const convo = [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))];
    const MAX_ITERS = 6;

    const mkRequest = (model, maxTokens, useTools) => {
      const body = { model, messages: convo, temperature: 0.7, max_tokens: maxTokens };
      if (useTools) { body.tools = openaiTools; body.tool_choice = 'auto'; }
      return this.client.chat.completions.create(body, signal ? { signal } : undefined);
    };

    const complete = async (useTools, maxTokens, iter = 0) => {
      try {
        return await mkRequest(this.model, maxTokens, useTools);
      } catch (error) {
        // Recover Llama's text-format tool calls that Groq's parser rejected.
        if (useTools && isToolUseFailed(error)) return recoverFromToolFailure(error, iter);
        if (error.status === 429) {
          console.log('⚡ Rate limited, falling back to fast model');
          // The 8b model is MORE prone to text-format tool calls, so recover
          // tool_use_failed on the fallback too instead of hard-failing the turn.
          try {
            return await mkRequest(this.fastModel, Math.min(maxTokens, 1024), useTools);
          } catch (e2) {
            if (useTools && isToolUseFailed(e2)) return recoverFromToolFailure(e2, iter);
            throw e2;
          }
        }
        throw error;
      }
    };

    for (let iter = 0; iter < MAX_ITERS; iter++) {
      if (signal?.aborted) return;

      const resp = await complete(true, 2048, iter);
      if (signal?.aborted) return;

      const msg = resp.choices?.[0]?.message || {};
      const toolCalls = msg.tool_calls || [];

      // Emit any prose the model produced alongside its decision.
      if (msg.content) yield { type: 'text', text: msg.content };

      if (toolCalls.length === 0) return; // final answer delivered

      convo.push({ role: 'assistant', content: msg.content || null, tool_calls: toolCalls });
      for (const tc of toolCalls) {
        if (signal?.aborted) return;
        let input = {};
        try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* leave {} */ }
        yield { type: 'tool_start', name: tc.function?.name, input };
        let result;
        try { result = await execute(tc.function?.name, input); }
        catch (e) { result = `Error: ${e.message}`; }
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? '');
        yield { type: 'tool_result', name: tc.function?.name, result: text };
        convo.push({ role: 'tool', tool_call_id: tc.id, content: text || '(no output)' });
      }
    }

    // Safety net: ran the whole tool budget without a closing answer — force a
    // tool-less reply so the user ALWAYS hears a response (yield unconditionally,
    // with a deterministic fallback if the model returns empty content).
    if (signal?.aborted) return;
    const final = await complete(false, 1024);
    const text = final.choices?.[0]?.message?.content;
    yield { type: 'text', text: text || 'Sorry, I ran out of steps on that — could you try rephrasing?' };
  }

  // ─── Non-streaming chat (memory extraction, background tasks) ───
  // Set useMainModel=true for tasks needing strong instruction-following.
  async chat(system, messages, { useMainModel = false } = {}) {
    if (this.provider === 'claude') {
      return this._claudeChat(system, messages, useMainModel);
    } else {
      return this._groqChat(system, messages, useMainModel);
    }
  }

  async _claudeChat(system, messages, useMainModel = false) {
    const response = await this.client.messages.create({
      model: useMainModel ? this.model : this.fastModel,
      max_tokens: 1024,
      system,
      messages,
    });
    return response.content.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  }

  async _groqChat(system, messages, useMainModel = false) {
    const response = await this.client.chat.completions.create({
      model: useMainModel ? this.model : this.fastModel,
      messages: [{ role: 'system', content: system }, ...messages],
      temperature: 0.3,
      max_tokens: 1024,
    });
    return response.choices[0]?.message?.content || '';
  }
}

module.exports = LLMService;
