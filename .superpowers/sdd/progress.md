# SDD ledger — plan: docs/superpowers/plans/2026-11-22-usable-mvp.md

| Task | Status | Commit | Verification |
|---|---|---|---|
| Core state, diff, task packets | done | 4468949 | 15 tests, typecheck |
| Generators (OpenAPI 3.1, Prisma, AsyncAPI, Mermaid, docs/ADR) | done | 1dcf483 | 21 tests, typecheck |
| Deterministic validators + self-heal | done | e022b75 | 26 tests, typecheck |
| Packager (ZIP, metrics, OpenCode agents, redaction) | done | 2c7e6f1 | 30 tests, typecheck |
| App pipeline, HTTP server, web UI, CLI, project subagents | done | 5f82017 | 41 tests, typecheck, build |
| Browser smoke test of demo flow | done | — | UI produced ZIP: 17/17 metrics, 4 tasks, validation ok |

## v0.2 hardening (2026-11-22)

| Task | Status | Commit | Verification |
|---|---|---|---|
| Domain entity model (fields, relations, sanitizer) | done | working tree | state/diff/sanitize tests |
| Entity-driven OpenAPI CRUD + engine-aware Prisma | done | working tree | generator golden tests |
| Real BPE tokenizer + package-wide context ratio | done | working tree | task-packet + packager metrics |
| Configurable verify commands (pnpm/npm/yarn/bun × vitest/jest/node) | done | working tree | task-packet + packager tests |
| Structural JSON Schema validation + real deterministic coverage | done | working tree | validator tests |
| Preview API, state import, rate limiting, runtime options in UI | done | working tree | server tests |
| Docker, CI, LICENSE, .env.example, example architecture | done | working tree | typecheck + tests + docker build (CI) |

Notes:
- `pnpm test` → 74 tests; `pnpm typecheck` → clean.
- Demo mode now derives domain entities (orders/users/products) or a default `Resource`.
- Token budgets are measured with `gpt-tokenizer` instead of characters/4.

Notes:
- Demo mode requires no API key; BYOK uses one OpenAI-compatible endpoint with one retry.
- API keys are used per request and redacted from every packaged file.
- Reference architecture (`postgres redis react api`) passes every approved output metric.
