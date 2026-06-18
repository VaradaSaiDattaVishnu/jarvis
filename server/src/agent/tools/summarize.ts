import { tool } from "@langchain/core/tools";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { createChatModel } from "../model";
import { getChunksBySource, listSources } from "../../rag/store";

/**
 * SUMMARISE a whole document.
 *
 * Unlike document_search (which retrieves the few chunks closest to a query),
 * this tool pulls back EVERY chunk of one source, stitches them into the full
 * document, and asks the model to condense it. It's a single, direct model call
 * — not the agent loop — so we build the messages ourselves: a SystemMessage
 * carries the instruction, the HumanMessage carries the document text. Keeping
 * the instruction and the (untrusted) document in separate turns is the clean
 * pattern and also limits how much the document can hijack the instruction.
 *
 * One call is the right call here: at personal-document scale the whole file
 * fits comfortably in Haiku's context window, so there's no need for a
 * multi-step map-reduce. createChatModel() caps output at 1024 tokens, which
 * naturally keeps the summary concise.
 */
export const summarizeDocument = tool(
  async ({ source }) => {
    const chunks = getChunksBySource(source);

    // No chunks → either the name is wrong or nothing is ingested. Tell the
    // agent which, and list what IS available so it can suggest the right name.
    if (chunks.length === 0) {
      const available = listSources();
      if (available.length === 0) {
        return "The knowledge base is empty — no documents have been ingested yet.";
      }
      // listSources() returns { source, chunks } rows (it also powers the UI view),
      // so pull out just the filenames for the message.
      const names = available.map((s) => s.source).join(", ");
      return `No document named "${source}" is in the knowledge base. Available documents: ${names}.`;
    }

    const documentText = chunks.join("\n\n");

    const model = createChatModel();
    const response = await model.invoke([
      new SystemMessage(
        "You are a precise summariser. Write a concise summary of the document the user provides: " +
          "a short paragraph capturing its main points. Stay faithful to the text — never add facts " +
          "that aren't in it. Plain prose, no preamble.",
      ),
      new HumanMessage(`Summarise this document (source: ${source}):\n\n${documentText}`),
    ]);

    // Anthropic content can be a plain string or structured blocks; normalise to text.
    const summary = response.content;
    return typeof summary === "string" ? summary : JSON.stringify(summary);
  },
  {
    name: "summarize_document",
    description:
      "Produce a concise summary of ONE document in the user's knowledge base, given its source " +
      "filename (e.g. 'jarvis-overview.md'). Use this when the user asks to summarize/summarise a " +
      "specific document. To look up facts across documents instead, use document_search.",
    schema: z.object({
      source: z
        .string()
        .describe("The exact source filename of the document to summarise, e.g. 'jarvis-overview.md'"),
    }),
  },
);
