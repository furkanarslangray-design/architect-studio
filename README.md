# AI Principal Architect

Fikrini, OpenCode subagent'larının düşük token ile inşa edebileceği **doğrulanmış bir
ajan paketine** çeviren açık kaynak, BYOK tabanlı araç.

## Ne yapar?

1. Doğal dildeki fikri alır (veya bir `ArchState` JSON'u içe aktarır).
2. Mimari state'i üretir: bileşenler, bağlantılar, kararlar ve **domain entity'leri**.
3. OpenAPI 3.1 (entity CRUD), Prisma (engine'e göre provider + entity modelleri),
   AsyncAPI 2.6, Mermaid, `ARCHITECTURE.md`, `WHITEPAPER.md` ve ADR'leri üretir.
4. Her artifact'ı deterministik olarak doğrular; onarılabilir hataları LLM'siz düzeltir.
5. Görevleri `TASKS.md` dizini + `tasks/T-*.md` dilimlenmiş paketlerine böler.
6. Hedef projenin paket yöneticisine/test runner'ına uygun `verify` komutları yazar.
7. `.opencode/agents/{implementer,validator,reviewer}.md` tanımlarını ekler.
8. `metrics.json` + `MANIFEST.md` ile birlikte ZIP üretir.

## Hızlı başlangıç

```bash
pnpm install
pnpm dev
# http://localhost:3000
```

Demo modu varsayılan olarak açıktır; API anahtarı gerektirmez. Node >= 22 ve pnpm gerekir.

### BYOK

Arayüzde demo modunu kapat; API anahtarı, model ve OpenAI-uyumlu base URL gir.
Anahtar yalnızca istek süresince kullanılır; diske yazılmaz, loglanmaz ve pakete konmaz.

## Domain modeli

`ArchState.entities` gerçek iş nesnelerini tanımlar:

```json
{
  "id": "ent-order",
  "name": "Order",
  "serviceId": "svc-orders",
  "databaseId": "db-orders",
  "fields": [
    { "name": "id", "type": "uuid", "primary": true },
    { "name": "total", "type": "decimal", "required": true },
    { "name": "status", "type": "string", "required": true }
  ],
  "relations": [{ "target": "ent-user", "field": "userId" }]
}
```

- Alan tipleri: `string`, `text`, `int`, `float`, `decimal`, `boolean`, `datetime`, `date`, `uuid`, `json`.
- `relations` Prisma'da foreign-key kolonu + `@@index` üretir; OpenAPI'de ilişki kimliği taşınır.
- Entity tanımlanmazsa servis başına generic `Item` sözleşmesine düşülür.
- Demo modu `order`, `user`, `product` gibi anahtar kelimelerden entity türetir; aksi halde
  ilk servise bağlı bir `Resource` üretir.
- `examples/architecture.json` içe aktarılabilir tam bir örnektir.

## Web arayüzü

- Fikir formu ve demo/BYOK alanları.
- Hedef **paket yöneticisi** (`pnpm`/`npm`/`yarn`/`bun`) ve **test runner** (`vitest`/`jest`/`node`).
- **Önce önizle** ile ZIP indirmeden bileşenleri, entity'leri, görev dalgalarını, metrikleri
  ve doğrulama sonuçlarını görürsün.
- **ArchState JSON** yapıştırarak mevcut mimariyi paketleyebilirsin.
- ZIP indirme ve `X-Metrics-Passed`, `X-Task-Count`, `X-Entities`, `X-Validation` özetleri.

## HTTP API

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/health` | `{ ok, version }` |
| GET | `/api/version` | Sürüm ve kullanılan tokenizer |
| POST | `/api/preview` | State + görevler + metrikler + doğrulama (JSON) |
| POST | `/api/generate` | ZIP (`application/zip`) |

Gövde alanları: `idea` **veya** `state`, `demo`, `apiKey`, `baseUrl`, `model`,
`packageManager`, `testRunner`. İstek gövdesi 256 KB ile sınırlıdır; `/api/generate` ve
`/api/preview` IP başına dakikalık bütçeyle korunur (`RATE_LIMIT_PER_MIN`, varsayılan 120).

Hata kodları: `400` geçersiz girdi/state/runtime, `413` gövde çok büyük, `429` rate limit,
`502` LLM sağlayıcı hatası.

## CLI

```bash
# Demo
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Mevcut state'ten paket + dizine aç
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Sadece önizleme (ZIP yazmaz)
pnpm generate -- --json examples/architecture.json --preview

# BYOK + hedef runtime
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini \
  --package-manager npm --test-runner jest
```

Diğer bayraklar: `--out`, `--extract`, `--base-url`, `--help`.

## Paket içeriği

- `ARCHITECTURE.md` (bileşenler + domain modeli + diagram), `WHITEPAPER.md`, `AGENTS.md`, `.cursorrules`
- `adr/ADR-*.md`
- `TASKS.md` ve `tasks/T-*.md` (kendi kendine yeterli görev paketleri)
- `.opencode/agents/{implementer,validator,reviewer}.md`
- `openapi.yaml`, `asyncapi.yaml`, `prisma/schema.prisma`, `diagram.mmd`
- `metrics.json`, `MANIFEST.md`

## Metrikler

Token sayımı gerçek BPE tokenizer (`gpt-tokenizer`) ile yapılır.

| Metrik | Hedef |
|---|---|
| `packet_prompt_tokens_p95` | ≤ 1500 |
| `packet_prompt_tokens_max` | ≤ 2500 |
| `context_slice_ratio` | ≤ 0.10 (paketin tamamına göre) |
| `duplicate_context_ratio` | ≤ 0.05 |
| `files_per_task` | ≤ 5 |
| `dependency_depth` | ≤ 4 |
| `parallel_groups` | ≥ min(3, düğüm sayısı − 1) |
| `subagent_steps` | ≤ 8 |
| `contract_coverage` | 100% |
| `acceptance_coverage` | 100% |
| `validator_pass_rate` | 100% |
| `deterministic_checks` | ≥ 10 |
| `self_heal_rounds` | ≤ 2 |
| `unresolved_refs` | 0 |
| `deterministic_coverage` | ≥ 90% |
| `index_tokens` | ≤ 800 |
| `package_size_kb` | ≤ 500 |
| `state_to_package_ms` | < 10000 |

`deterministic_coverage`, paketteki artifact türlerinden deterministik doğrulayıcısı
olanların oranıdır; doğrulanamayan bir dosya eklersen düşer ve issue üretir.

## Deterministik doğrulama ve self-heal

- OpenAPI: 3.1 sürümü, `info`, boş olmayan `paths`, benzersiz `operationId`, cevaplar,
  `$ref` çözümü ve JSON Schema yapısal kontrolü (`required` ↔ `properties`, `items`, tipler).
- AsyncAPI: 2.x, kanallarda `publish`/`subscribe`, mesaj ve `$ref` çözümü.
- Prisma: provider, brace dengesi, PascalCase modeller, benzersiz `@@map`.
- Mermaid, `TASKS.md` (ve istenirse her görev dosyası), `metrics.json`, `MANIFEST.md`,
  OpenCode ajanları, ADR'ler ve doküman başlıkları.
- Onarılabilir hatalar (eksik OpenAPI başlığı/`paths`, boş Mermaid, bozuk metrics, eksik
  MANIFEST, eksik Prisma datasource) en fazla 2 turda deterministik onarılır.

## Testler

```bash
pnpm test        # 74 test
pnpm typecheck
pnpm build       # typecheck + test
```

## Docker

```bash
docker build -t architect-studio .
docker run --rm -p 3000:3000 --env-file .env.example architect-studio
```

`/api/health` üzerinden healthcheck tanımlıdır. `.env.example` içinde `PORT` ve
`RATE_LIMIT_PER_MIN` bulunur.

## CI

`.github/workflows/ci.yml`: pnpm + Node 22 ile `typecheck`, `test` ve Docker image build.

## Bilinçli sınırlar

- Kimlik doğrulama, kullanıcı/oturum ve kalıcılık yoktur; sunucu tek süreç ve in-memory'dir.
- Görev metinleri node türüne göre şablonlanır; LLM yalnızca state üretir.
- Kabul kriterleri üretilir, hedef kod tabanında çalıştırılmaz.
- Tarayıcı E2E (Playwright) yoktur; indirme akışı HTTP seviyesinde test edilir.
- AST/tersine mühendislik, FinOps, STRIDE/compliance, MCP ve Mock & Trace kapsam dışıdır.

## Tasarım ve plan

- `docs/superpowers/specs/2026-11-22-agent-package-design.md`
- `docs/superpowers/plans/2026-11-22-usable-mvp.md`
- `PROJECT-SUMMARY.md` — geliştirici devir notu
