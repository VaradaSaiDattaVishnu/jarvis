import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { embed } from "../../rag/embeddings";
import { searchChunks } from "../../rag/store";

/**
 * RAG as a TOOL.
 *
 * Rather than a separate retrieval chain, document search is just another tool
 * the agent can choose. When the user asks about their own documents, the model
 * calls this; we embed the QUERY with the same MiniLM model used at ingest time,
 * find the closest chunks by cosine similarity, and return them tagged with their
 * source so JARVIS can cite them. (The system prompt tells it to cite.)
 */
export const documentSearch = tool(
  async ({ query }) => {
    const queryVector = await embed(query);
    const results = searchChunks(queryVector, 4);

    if (results.length === 0) {
      return "The knowledge base is empty — no documents have been ingested yet.";
    }

    return results
      .map((r, i) => `[${i + 1}] (source: ${r.source})\n${r.content}`)
      .join("\n\n");
  },
  {
    name: "document_search",
    description:
      "Search the user's personal documents / knowledge base. Use this for questions about the user's own notes, files, or uploaded documents. Always cite the source filename(s) in your answer.",
    schema: z.object({
      query: z.string().describe("What to look up in the user's documents"),
    }),
  },
);
