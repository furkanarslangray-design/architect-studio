# Usable Agent Package MVP — Implementation Plan

> **For agentic workers:** Execute task by task. Each task ends with passing tests and a commit.

**Goal:** Doğal dilden mimari state üretip, OpenCode subagent'ları için dilimlenmiş, deterministik doğrulanmış ve indirilebilir bir ajan paketi oluşturan çalışan MVP.

**Architecture:** `ArchState` → üreticiler → doğrulayıcı → `TaskPacketBuilder` → ZIP + `metrics.json`. Web arayüzü ince bir HTTP katmanıdır; durum tutmaz.

**Tech Stack:** TypeScript, Node 22, pnpm, Zod, YAML, JSZip, Vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-22-agent-package-design.md`

## Global Constraints

- API anahtarı diske yazılmaz, loglanmaz, ZIP'e konmaz.
- LLM yalnızca state üretimi ve isteğe bağlı onarım için; doğrulama deterministik.
- Görev paketi başına prompt hedefi p95 ≤ 1500 token, max 2500.
- `TASKS.md` yalnızca dizin; asıl görevler `tasks/T-*.md`.
- OpenCode agent `steps` ≤ 8.
- Deterministik doğrulama kapsamı ≥ %90.
- Paket boyutu ≤ 500 KB.

## File Structure

```text
architect-studio/
  package.json                  # workspace scripts + deps
  pnpm-workspace.yaml
  tsconfig.base.json
  packages/core/
    src/{state.ts,diff.ts,task-packet.ts,metrics.ts,ids.ts}
    tests/{state.test.ts,diff.test.ts,task-packet.test.ts}
  packages/generators/
    src/{openapi.ts,prisma.ts,asyncapi.ts,mermaid.ts,docs.ts,index.ts}
    tests/{generators.test.ts}
    tests/fixtures/{minimal.json,ecommerce.json}
  packages/validators/
    src/{index.ts,self-heal.ts}
    tests/{validators.test.ts}
  packages/packager/
    src/{build-package.ts,opencode-agents.ts,zip.ts,report.ts,index.ts}
    tests/{packager.test.ts}
  packages/app/
    src/{server.ts,llm.ts,demo.ts,pipeline.ts}
    tests/{pipeline.test.ts}
  web/index.html
  .opencode/agents/{implementer,validator,reviewer}.md
```

## Task 1: Workspace + contracts

**Files:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/core/src/state.ts`, `packages/core/src/metrics.ts`

**Interfaces:**
- `ArchNode { id: string; kind: 'service'|'database'|'queue'|'external'|'ui'; name: string; props: Record<string, string|number|boolean> }`
- `ArchEdge { id: string; from: string; to: string; protocol: 'http'|'grpc'|'event'|'sql'; contractRef?: string }`
- `ArchState { version: number; nodes: ArchNode[]; edges: ArchEdge[]; decisions: Decision[] }`
- `Decision { id: string; title: string; context: string; decision: string; alternatives: string[] }`
- `MetricReport { name: string; value: number; target: string; pass: boolean }`

- [ ] Failing test: `parseState` reddeder eksik node id; kabul eder geçerli state.
- [ ] Zod şemalarını yaz, `parseState(input): ArchState` ve `safeParseState` ekle.
- [ ] `estimateTokens(text): number` (ceil(chars/4)) ve `metric()` helper.
- [ ] `pnpm test` geçsin; commit.

## Task 2: State validation + diff

**Files:** `packages/core/src/ids.ts`, `packages/core/src/diff.ts`, `packages/core/tests/diff.test.ts`

**Interfaces:**
- `validateState(state): string[]` — çift ID, dangling edge, cycle, boş isim.
- `diffStates(a,b): { addedNodes; removedNodes; changedNodes; addedEdges; removedEdges }`
- `dependencyDepth(state): number`
- `contractCoverage(state, packets): number`

- [ ] Failing tests: dangling edge, duplicate ID, cycle, depth > 4.
- [ ] Implementasyon; `diffStates` node/edge ID karşılaştırması.
- [ ] Testler + commit.

## Task 3: TaskPacketBuilder

**Files:** `packages/core/src/task-packet.ts`, `packages/core/tests/task-packet.test.ts`

**Interfaces:**
- `buildTaskPackets(state): TaskPacket[]`
- `buildTaskIndex(packets): TaskIndex`
- `renderTaskMarkdown(packet): string`
- `TaskPacket { id; title; dependsOn; parallelGroup; files; context; acceptance; verifyCommand; tokenCount }`

Kurallar: her servis için bir implementasyon görevi; her veritabanı için şema görevi; edge'ler bağımlılık üretir. Bağlam yalnızca ilgili node + komşu edge'ler + ilgili sözleşme dilimi. `TASKS.md` dizini ≤ 800 token.

- [ ] Failing test: 3 servis + 1 DB → en az 4 görev; her görevde acceptance ve verifyCommand.
- [ ] Token bütçesi testi: her paket ≤ 2500, p95 ≤ 1500.
- [ ] `context_slice_ratio ≤ 0.10`, `duplicate_context_ratio ≤ 0.05`, `files_per_task ≤ 5`.
- [ ] Implementasyon + commit.

## Task 4: Generators

**Files:** `packages/generators/src/{openapi,prisma,asyncapi,mermaid,docs,index}.ts`, tests + fixtures.

**Interfaces:**
- `generateOpenAPI31(state): string`
- `generatePrisma(state): string`
- `generateAsyncAPI(state): string`
- `generateMermaid(state): string`
- `generateDocs(state, packets): Record<string,string>` (`ARCHITECTURE.md`, `WHITEPAPER.md`, `adr/ADR-*.md`, `.cursorrules`)

- [ ] Failing golden test: minimal fixture → OpenAPI 3.1 JSON parse, Prisma `model`, AsyncAPI `asyncapi`, Mermaid `flowchart`.
- [ ] Servis başına `/health` ve `/api/<slug>`; DB başına Prisma modeli; queue başına AsyncAPI kanalı.
- [ ] Docs: her decision için ADR; `.cursorrules` görev paketlerini işaret eder.
- [ ] Testler + commit.

## Task 5: Deterministic validator + self-heal

**Files:** `packages/validators/src/{index,self-heal}.ts`, tests.

**Interfaces:**
- `validateArtifacts(files): ValidationReport`
- `repairArtifacts(files): { files; rounds }` — deterministik onarım (eksik `openapi`, `info`, `asyncapi`, boş Mermaid başlığı).

- [ ] Failing tests: bozuk OpenAPI yakalanır; eksik `info` onarılır; geçerli artifact %100 geçer.
- [ ] `validator_pass_rate`, `unresolved_refs`, `deterministic_coverage` hesapla.
- [ ] Testler + commit.

## Task 6: Packager + metrics

**Files:** `packages/packager/src/{build-package,opencode-agents,zip,report,index}.ts`, tests.

**Interfaces:**
- `buildPackage(state, opts?): Promise<{ zip: Buffer; files: Record<string,string>; metrics: MetricReport[] }>`
- `renderOpenCodeAgent(role): string`

- [ ] Failing test: ZIP içinde `TASKS.md`, `tasks/T-001.md`, `.opencode/agents/implementer.md`, `metrics.json` var.
- [ ] `metrics.json` tüm hedefleri içerir; `pass` alanı doğru.
- [ ] Secret redaction testi: `sk-` içeren anahtar ZIP'te yok.
- [ ] Boyut ≤ 500 KB, süre < 10 sn testi.
- [ ] Testler + commit.

## Task 7: LLM + demo state producer

**Files:** `packages/app/src/{llm,demo,pipeline}.ts`, tests.

**Interfaces:**
- `ideaToState(idea, opts): Promise<ArchState>`
- `demoState(idea): ArchState` — anahtar kelimelerden servis/DB/queue üretir.
- `runPipeline(idea, opts): Promise<PackageResult>`

- [ ] Failing test: demo modu "postgres redis api" → en az 3 node.
- [ ] OpenAI-uyumlu `/v1/chat/completions` çağrısı; JSON schema; Zod doğrulama; 1 retry; hata durumunda anlaşılır mesaj.
- [ ] Anahtarın hata mesajına/loga sızmadığını test et.
- [ ] Testler + commit.

## Task 8: HTTP server + web UI

**Files:** `packages/app/src/server.ts`, `web/index.html`, `.opencode/agents/*.md`

**Interfaces:**
- `GET /` → `web/index.html`
- `POST /api/generate` → `{ idea, apiKey?, baseUrl?, model?, demo? }` → ZIP (`application/zip`)
- `GET /api/health` → `{ ok: true }`

- [ ] Failing test: `GET /api/health` 200; `POST /api/generate` demo modu ZIP döner.
- [ ] Form: fikir, demo checkbox, API key, model, base URL; indirme bağlantısı.
- [ ] `.opencode/agents/implementer.md`, `validator.md`, `reviewer.md` ekle; `steps: 8`, dar izinler.
- [ ] `pnpm dev` ile çalıştır; manuel smoke test; commit.

## Task 9: README + final verification

**Files:** `README.md`

- [ ] Kurulum, çalıştırma, demo ve BYOK kullanımı.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm build` temiz.
- [ ] Örnek çıktıyı `examples/` altına koy.
- [ ] Final commit.

## Review Focus

1. Döngüsel bağımlılık → Task 2 testi.
2. Dangling edge → Task 2 testi.
3. Aynı isimli iki servis → Task 4 collision testi.
4. API anahtarı sızıntısı → Task 6/7 testi.
5. Kabul kriteri/verifyCommand eksik görev → Task 3 testi.
