import { createAgent, dynamicSystemPromptMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createChatModel } from "./model";
import { tools } from "./tools";
import { recallFacts } from "../memory/store";

/**
 * JARVIS's persona + behavioural instructions.
 * Kept short on purpose: replies are spoken aloud, so they must be concise.
 */
const SYSTEM_PROMPT =
  "You are JARVIS, a concise and helpful voice assistant. " +
  "Use the available tools when they would help answer accurately. " +
  "For questions about the user's own documents or notes, use document_search " +
  "and cite the source filename(s). " +
  "To summarise a whole document, use summarize_document with its filename. " +
  "When the user shares a durable fact about themselves, save it with remember_fact. " +
  "Because your replies are spoken aloud, keep them short and natural — " +
  "a sentence or two, no markdown, no bullet lists.";

/**
 * The agent.
 *
 * `createAgent` (LangChain v1) compiles the ReAct graph: agent node ⇄ tools node,
 * looping while the model keeps requesting tools.
 *
 * The `checkpointer` is SHORT-TERM (conversation) memory: MemorySaver stores each
 * thread's message history in-process, keyed by `thread_id`. Because of it, every
 * /chat call sends only the NEW message — LangChain replays the rest of the thread.
 * (LONG-TERM memory — durable facts — lives separately in SQLite. JARVIS *saves*
 * them with the remember_fact tool; *recall* is always-on, injected below.)
 */
const agent = createAgent({
  model: createChatModel(),
  tools,
  systemPrompt: SYSTEM_PROMPT,
  middleware: [
    // Always-on fact recall. This re-runs every turn at model-call time, so a fact
    // saved this turn is visible on the very next one — no waiting, no tool call.
    // Crucially, setting the prompt HERE (rather than prepending a SystemMessage to
    // the input) means the facts never get checkpointed into the thread history, so
    // they don't pile up or drift as the conversation grows — each call gets exactly
    // one fresh copy of the current facts.
    dynamicSystemPromptMiddleware(() => {
      const facts = recallFacts();
      if (facts.length === 0) return SYSTEM_PROMPT;
      const knownFacts = facts.map((fact) => `- ${fact}`).join("\n");
      return `${SYSTEM_PROMPT}\n\nKnown facts about the user:\n${knownFacts}`;
    }),
  ],
  checkpointer: new MemorySaver(),
});

/**
 * Run one turn through the agent and return JARVIS's reply.
 *
 * `threadId` selects which conversation this message belongs to. Same id across
 * calls → JARVIS remembers the exchange; a new id → a fresh conversation.
 */
export async function runAgent(userMessage: string, threadId: string): Promise<string> {
  const result = await agent.invoke(
    { messages: [new HumanMessage(userMessage)] },
    { configurable: { thread_id: threadId } },
  );

  // After the loop finishes, the final assistant turn is the last message.
  const finalMessage = result.messages.at(-1);
  const content = finalMessage?.content ?? "";
  return typeof content === "string" ? content : JSON.stringify(content);
}
