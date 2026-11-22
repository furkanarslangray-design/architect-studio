# AI Principal Architect

Fikrini, OpenCode subagent'larının düşük token ile inşa edebileceği doğrulanmış
bir ajan paketine çeviren açık kaynak, BYOK tabanlı MVP.

## Ne yapar?

1. Doğal dildeki fikri alır (veya `ArchState` JSON'u içe aktarır).
2. Mimari state'i üretir.
3. OpenAPI 3.1, Prisma, AsyncAPI, Mermaid, `ARCHITECTURE.md`, Whitepaper ve ADR'leri üretir.
4. Her artifact'ı deterministik olarak doğrular; gerekirse kendi kendine onarır.
5. Görevleri `TASKS.md` dizini + `tasks/T-*.md` dilimlenmiş paketlerine böler.
6. `.opencode/agents/{implementer,validator,reviewer}.md` tanımlarını ekler.
7. ZIP + `metrics.json` + `MANIFEST.md` üretir.

## Kurulum

```bash
pnpm install
```

## Çalıştırma

```bash
pnpm dev
# http://localhost:3000
```

Demo modu varsayılan olarak açıktır; API anahtarı gerektirmez.

### BYOK

Arayüzde demo modunu kapat, API anahtarını, modeli ve OpenAI-uyumlu base URL'yi
gir. Anahtar yalnızca istek süresince kullanılır; diske yazılmaz, loglanmaz ve
pakete konmaz.

### CLI

```bash
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo
pnpm generate -- --json architecture.json --out out/package.zip
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini
```

## Testler

```bash
pnpm test
pnpm typecheck
```

## Paket içeriği

- `ARCHITECTURE.md`, `WHITEPAPER.md`, `AGENTS.md`, `.cursorrules`
- `adr/ADR-*.md`
- `TASKS.md` ve `tasks/T-*.md`
- `.opencode/agents/implementer.md`, `validator.md`, `reviewer.md`
- `openapi.yaml`, `asyncapi.yaml`, `prisma/schema.prisma`, `diagram.mmd`
- `metrics.json`, `MANIFEST.md`

## Kapsam dışı (şimdilik)

Tersine mühendislik/AST, FinOps, STRIDE, sürükle-bırak tuval, Mock & Trace, MCP,
masaüstü uygulaması. Bunlar sonraki fazlar için planlandı.

## Tasarım ve plan

- `docs/superpowers/specs/2026-11-22-agent-package-design.md`
- `docs/superpowers/plans/2026-11-22-usable-mvp.md`
