import { countTokens } from "gpt-tokenizer";

export const TOKENIZER_ID = "gpt-tokenizer/cl100k_base";

/**
 * Real BPE token count instead of the previous characters/4 estimate.
 * The encoding is deterministic, so metrics stay reproducible across runs.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return countTokens(text);
}

export interface TokenBreakdown {
  tokens: number;
  characters: number;
  tokensPerCharacter: number;
}

export function describeTokens(text: string): TokenBreakdown {
  const tokens = estimateTokens(text);
  return {
    tokens,
    characters: text.length,
    tokensPerCharacter: text.length === 0 ? 0 : Math.round((tokens / text.length) * 1000) / 1000,
  };
}
