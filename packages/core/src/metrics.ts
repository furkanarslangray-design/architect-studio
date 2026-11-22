export { estimateTokens, describeTokens, TOKENIZER_ID } from "./tokenizer";
export type { TokenBreakdown } from "./tokenizer";

export interface MetricReport {
  name: string;
  value: number;
  target: string;
  pass: boolean;
}

export function lteMetric(name: string, value: number, target: number): MetricReport {
  return {
    name,
    value: round(value),
    target: `<= ${target}`,
    pass: value <= target,
  };
}

export function gteMetric(name: string, value: number, target: number): MetricReport {
  return {
    name,
    value: round(value),
    target: `>= ${target}`,
    pass: value >= target,
  };
}

export function eqMetric(name: string, value: number, target: number): MetricReport {
  return {
    name,
    value: round(value),
    target: `== ${target}`,
    pass: value === target,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
