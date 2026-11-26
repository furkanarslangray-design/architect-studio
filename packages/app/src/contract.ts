import { z } from "zod";

/**
 * HTTP contract for `FRONTEND_SPEC.md` §4/§5.
 *
 * The schemas are the machine-readable half of the spec: the contract tests
 * validate real responses against them, and the spec text is checked against
 * `ENDPOINTS` so a route cannot appear in one place only. `passthrough()` keeps
 * additive fields legal; only documented fields are required.
 */

export const ENDPOINTS = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/version" },
  { method: "GET", path: "/api/i18n" },
  { method: "GET", path: "/api/sandboxes" },
  { method: "GET", path: "/api/rea" },
  { method: "POST", path: "/api/preview" },
  { method: "POST", path: "/api/generate" },
  { method: "POST", path: "/api/chat" },
  { method: "POST", path: "/api/reverse" },
  { method: "POST", path: "/api/sandbox" },
] as const;

export const ERROR_CODES = [
  "invalid_idea",
  "invalid_state",
  "empty_message",
  "invalid_json",
  "invalid_path",
  "path_not_allowed",
  "reverse_disabled",
  "reverse_busy",
  "reverse_timeout",
  "invalid_sandbox",
  "sandbox_failed",
  "sandbox_unavailable",
  "invalid_package_manager",
  "invalid_test_runner",
  "unsupported_runtime",
  "not_found",
  "payload_too_large",
  "rate_limited",
  "internal_error",
  "llm_failed",
] as const;

export const errorEnvelopeSchema = z
  .object({
    error: z.string().min(1),
    code: z.string().min(1),
    details: z.unknown().optional(),
    detail: z.string().optional(),
  })
  .passthrough();

// --- ArchState ------------------------------------------------------------

export const archNodeSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    name: z.string().min(1),
    props: z.record(z.unknown()).default({}),
  })
  .passthrough();

export const archEdgeSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().min(1),
    protocol: z.string().min(1),
  })
  .passthrough();

export const decisionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    context: z.string(),
    decision: z.string().min(1),
    alternatives: z.array(z.string()),
  })
  .passthrough();

export const entityFieldSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    required: z.boolean(),
    unique: z.boolean().optional(),
    primary: z.boolean().optional(),
  })
  .passthrough();

export const entitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    fields: z.array(entityFieldSchema).min(1),
    relations: z.array(z.object({ target: z.string().min(1) }).passthrough()).optional(),
    serviceId: z.string().optional(),
    databaseId: z.string().optional(),
  })
  .passthrough();

export const archStateSchema = z
  .object({
    version: z.number().int().positive(),
    nodes: z.array(archNodeSchema).min(1),
    edges: z.array(archEdgeSchema),
    decisions: z.array(decisionSchema),
    entities: z.array(entitySchema),
  })
  .passthrough();

// --- GET endpoints --------------------------------------------------------

export const healthSchema = z.object({ ok: z.literal(true), version: z.string().min(1) });

export const localeSchema = z
  .object({ id: z.string().min(2), label: z.string().min(1) })
  .passthrough();

export const versionSchema = z
  .object({
    name: z.literal("architect-studio"),
    version: z.string().min(1),
    tokenizer: z.string().min(1),
    locales: z.array(localeSchema).min(1),
  })
  .passthrough();

export const i18nSchema = z
  .object({
    locale: z.string().min(2),
    defaultLocale: z.string().min(2),
    locales: z.array(localeSchema).min(1),
    messages: z.record(z.string()),
  })
  .passthrough();

export const sandboxAvailabilitySchema = z
  .object({
    id: z.string().min(1),
    available: z.boolean(),
    isolation: z.string().min(1),
    version: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export const sandboxesSchema = z.object({ sandboxes: z.array(sandboxAvailabilitySchema).min(1) });

export const reaDetectionSchema = z
  .object({
    available: z.boolean(),
    engine: z.enum(["rea", "rea-agents", "static"]),
    binary: z.string().optional(),
    version: z.string().optional(),
    reason: z.string().optional(),
    modes: z.array(z.string()),
  })
  .passthrough();

export const reaSchema = z.object({ detection: reaDetectionSchema });

// --- POST /api/preview, /api/generate, /api/chat --------------------------

export const metricSchema = z
  .object({
    name: z.string().min(1),
    value: z.number(),
    target: z.string().min(1),
    pass: z.boolean(),
  })
  .passthrough();

export const taskSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    dependsOn: z.array(z.string()),
    // Packets carry a string group id (`wave-0`), which the UI groups by.
    wave: z.string().min(1),
    files: z.array(z.string()),
    tokens: z.number(),
    entities: z.array(z.string()),
  })
  .passthrough();

export const validationSchema = z
  .object({
    ok: z.boolean(),
    passRate: z.number(),
    unresolvedRefs: z.number(),
    deterministicCoverage: z.number(),
    checksRun: z.number(),
    issues: z.array(z.object({ file: z.string(), message: z.string() }).passthrough()),
  })
  .passthrough();

export const previewSummarySchema = z
  .object({
    nodes: z.number().int().nonnegative(),
    edges: z.number().int().nonnegative(),
    entities: z.number().int().nonnegative(),
    decisions: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    waves: z.number().int().nonnegative(),
    tokenizer: z.string().min(1),
  })
  .passthrough();

export const sandboxSummarySchema = z
  .object({
    requested: z.string().min(1),
    resolved: z.string().min(1),
    fallback: z.boolean(),
    drivers: z.array(sandboxAvailabilitySchema),
  })
  .passthrough();

export const previewResponseSchema = z
  .object({
    locale: z.string().min(2),
    state: archStateSchema,
    diagram: z.string().min(1),
    files: z.record(z.string()),
    summary: previewSummarySchema,
    tasks: z.array(taskSchema),
    metrics: z.array(metricSchema).min(1),
    validation: validationSchema,
    artifacts: z.array(z.string()).min(1),
    sandbox: sandboxSummarySchema.optional(),
    research: z
      .object({ provider: z.string(), query: z.string(), results: z.array(z.unknown()) })
      .passthrough()
      .optional(),
    searchNote: z.string().optional(),
  })
  .passthrough();

export const chatChangeSchema = z
  .object({
    type: z.enum(["node", "edge", "entity", "field"]),
    action: z.enum(["added", "removed", "updated"]),
    target: z.string().min(1),
    detail: z.string(),
  })
  .passthrough();

export const chatResponseSchema = previewResponseSchema.extend({
  chat: z
    .object({
      reply: z.string().min(1),
      changes: z.array(chatChangeSchema),
      source: z.enum(["deterministic", "llm"]),
      intent: z.string().min(1),
      notes: z.array(z.string()),
    })
    .passthrough(),
});

/** `/api/generate` streams a ZIP; the metadata lives in headers (spec §4). */
export const generateHeadersSchema = z
  .object({
    "content-type": z.literal("application/zip"),
    "content-length": z.string().regex(/^\d+$/),
    "x-validation": z.enum(["ok", "failed"]),
    "x-task-count": z.string().regex(/^\d+$/),
    "x-entities": z.string().regex(/^\d+$/),
    "x-tokenizer": z.string().min(1),
    "x-locale": z.string().min(2),
  })
  .passthrough();

// --- POST /api/reverse, /api/sandbox --------------------------------------

export const reverseFindingSchema = z
  .object({
    kind: z.string().min(1),
    source: z.string().min(1),
    detail: z.string(),
  })
  .passthrough();

export const reaFindingSchema = z
  .object({
    id: z.string().min(1),
    category: z.string().min(1),
    title: z.string().min(1),
    detail: z.string(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(
      z
        .object({
          source: z.string().min(1),
          path: z.string().optional(),
          line: z.number().optional(),
          snippet: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const reverseResponseSchema = z
  .object({
    summary: z.string().min(1),
    root: z.string().min(1),
    state: archStateSchema,
    findings: z.array(reverseFindingSchema),
    warnings: z.array(z.string()),
    scannedFiles: z.number().int().nonnegative(),
    rea: z
      .object({
        engine: z.enum(["rea", "rea-agents", "static"]),
        detection: reaDetectionSchema,
        scannedArtifacts: z.number().int().nonnegative(),
        warnings: z.array(z.string()),
        findings: z.array(reaFindingSchema),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const sandboxResponseSchema = z
  .object({
    driver: z.string().min(1),
    isolation: z.string().min(1),
    exitCode: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    durationMs: z.number().nonnegative(),
    timedOut: z.boolean(),
    command: z.string().min(1),
    // The built-in temp-dir driver runs in-place, so the path can be empty.
    workspace: z.string(),
    resolved: z.string().min(1),
    requested: z.string().min(1),
    fallback: z.boolean(),
    files: z.number().int().nonnegative(),
    validation: validationSchema,
  })
  .passthrough();
