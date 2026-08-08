/**
 * Calculates memory retrievability using the Ebbinghaus-inspired decay formula.
 *
 * R(t) = baseImportance * e^(-λ(m) * (t - lastAccessed))
 * λ(m) = λ₀ / (1 + ln(1 + accessCount))
 *
 * λ₀ = 1.15e-7 per second ≈ 10-day half-life for unaccessed items.
 * Semantic facts with confidence > 0.9 have λ₀ = 0 (no decay).
 */
const LAMBDA_0 = 1.15e-7; // Base decay constant (per second)

export function computeDecay(
  baseImportance: number,
  accessCount: number,
  lastAccessedAt: number,
  nowMs: number
): number {
  const elapsedSeconds = Math.max(0, (nowMs - lastAccessedAt) / 1000);
  const lambda = LAMBDA_0 / (1 + Math.log(1 + accessCount));
  return baseImportance * Math.exp(-lambda * elapsedSeconds);
}

const EMBEDDING_DIM = 128;

export function generateSimpleEmbedding(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  for (const word of words) {
    // Hash word to a bucket
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const bucket = ((hash % EMBEDDING_DIM) + EMBEDDING_DIM) % EMBEDDING_DIM;
    vec[bucket]! += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] = vec[i]! / norm;
    }
  }
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
