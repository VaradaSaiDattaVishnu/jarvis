import { pipeline } from "@huggingface/transformers";

/**
 * Local MiniLM embeddings via Transformers.js — runs ON-DEVICE, no API and no key.
 * The model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) downloads once on first
 * use and is cached on disk. Loading the pipeline is expensive, so we do it lazily
 * and reuse the same instance for every call.
 */

// The library's `pipeline()` return type is a broad union; we narrow it to the
// one shape we use (text in → a tensor with a `.data` typed array out).
type FeatureExtractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<FeatureExtractor> | null = null;

function getExtractor(): Promise<FeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    ) as unknown as Promise<FeatureExtractor>;
  }
  return extractorPromise;
}

/**
 * Turn text into a 384-dimension, L2-normalised embedding vector.
 * `normalize: true` means cosine similarity later reduces to a dot product.
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}
