import { createAgent } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createChatModel } from "./model";
import { tools } from "./tools";

/**
 * JARVIS's persona + behavioural instructions.
 * Kept short on purpose: replies are spoken aloud, so they must be concise.
 */
const SYSTEM_PROMPT =
  "You are JARVIS, a concise and helpful voice assistant. " +
  "Use the available tools when they would help answer accurately. " +
  "For questions about the user's own documents or notes, use document_search " +
  "and cite the source filename(s). " +
  "When the user shares a durable fact about themselves, save it with remember_fact; " +
  "use recall_facts when you need to personalize a reply. " +
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
 * (LONG-TERM memory — durable facts — lives separately in SQLite via the memory tools.)
 */
const agent = createAgent({
  model: createChatModel(),
  tools,
  systemPrompt: SYSTEM_PROMPT,
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
