export interface MetricReport {
  name: string;
  value: number;
  target: string;
  pass: boolean;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
