import OpenAI from 'openai';

let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for embeddings');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  tokenCount: number;
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  const data = response.data[0];
  if (!data) {
    throw new Error('No embedding returned from OpenAI');
  }

  return {
    embedding: data.embedding,
    model: response.model,
    tokenCount: response.usage.total_tokens,
  };
}

export async function generateEmbeddings(
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const openai = getOpenAI();

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });

  return response.data.map((d) => ({
    embedding: d.embedding,
    model: response.model,
    tokenCount: Math.floor(response.usage.total_tokens / texts.length),
  }));
}

export function prepareTextForEmbedding(
  title: string,
  content: string,
  metadata?: Record<string, unknown>
): string {
  const parts = [title, content];

  if (metadata) {
    // Include key metadata fields that might be useful for search
    const metaStr = Object.entries(metadata)
      .filter(([_, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    if (metaStr) {
      parts.push(metaStr);
    }
  }

  return parts.join('\n\n');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
