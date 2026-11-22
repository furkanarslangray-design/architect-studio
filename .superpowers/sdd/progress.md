# SDD ledger — plan: docs/superpowers/plans/2026-11-22-usable-mvp.md

| Task | Status | Commit | Verification |
|---|---|---|---|
| Core state, diff, task packets | done | 4468949 | 15 tests, typecheck |
| Generators (OpenAPI 3.1, Prisma, AsyncAPI, Mermaid, docs/ADR) | done | 1dcf483 | 21 tests, typecheck |
| Deterministic validators + self-heal | done | e022b75 | 26 tests, typecheck |
| Packager (ZIP, metrics, OpenCode agents, redaction) | done | 2c7e6f1 | 30 tests, typecheck |
| App pipeline, HTTP server, web UI, CLI, project subagents | done | 5f82017 | 41 tests, typecheck, build |
| Browser smoke test of demo flow | done | — | UI produced ZIP: 17/17 metrics, 4 tasks, validation ok |

Notes:
- Demo mode requires no API key; BYOK uses one OpenAI-compatible endpoint with one retry.
- API keys are used per request and redacted from every packaged file.
- Reference architecture (`postgres redis react api`) passes every approved output metric.
