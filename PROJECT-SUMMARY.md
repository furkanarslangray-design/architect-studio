# PROJECT-SUMMARY — AI Principal Architect (v0.2)

Yeni geliştirici devir teslim notu. Son güncelleme: 2026-11-22.

## 1. Proje nerede?

**Klasör:** `/home/furkanarslangray/architect-studio` (bu çalışma kopyasında worktree)
**Branch:** `mvp`
**Durum:** v0.2 sertleştirme değişiklikleri çalışma ağacında (henüz commit edilmedi).

Çalıştırmak için:

```bash
pnpm install
pnpm dev              # http://localhost:3000
```

Gereksinim: Node >= 22, pnpm. `gpt-tokenizer`, `jszip`, `yaml`, `zod` bağımlılıkları kuruludur.

## 2. Proje ne yapıyor?

Doğal dildeki bir fikri (veya içe aktarılan `ArchState` JSON'unu) alır; doğrulanmış bir
**ajan paketi** (ZIP) üretir:

1. Fikri `ArchState` modeline çevirir (demo modu deterministik, BYOK modu OpenAI-uyumlu LLM).
2. Bileşenler, bağlantılar, kararlar ve **domain entity'leri** (alanlar + ilişkiler) üretir.
3. OpenAPI 3.1 entity CRUD, Prisma (engine'e göre provider), AsyncAPI, Mermaid,
   `ARCHITECTURE.md`, `WHITEPAPER.md`, ADR'ler üretir.
4. Artifact'ları deterministik olarak doğrular; onarılabilir hataları 2 tura kadar self-heal eder.
5. `TASKS.md` + `tasks/T-*.md` dilimlenmiş görev paketleri üretir (token bütçeli, bağımlılıklı).
6. `.opencode/agents/{implementer,validator,reviewer}.md` ekler.
7. `metrics.json` + `MANIFEST.md` ile birlikte ZIP olarak paketler.

```
idea / ArchState JSON ──> ideaToState() / parseState()
  ──> sanitizeState() (LLM çıktısı için deterministik temizlik)
  ──> ArchState { nodes, edges, decisions, entities }
  ──> buildPackage()
        ├─ generators (OpenAPI/Prisma/AsyncAPI/Mermaid/docs)
        ├─ task packets (TASKS.md + tasks/T-*.md)
        ├─ OpenCode agents
        ├─ validators (+ self-heal)
        └─ metrics + MANIFEST + ZIP
```

## 3. v0.2'de tamamlananlar

- **Domain entity modeli:** `ArchState.entities` (alan tipleri, `primary`/`required`/`unique`,
  servis/database sahipliği, entity ilişkileri). Doğrulama: eksik/yanlış türde referans,
  çift alan adı, çoklu primary, eksik ilişki hedefi.
- **Entity-driven sözleşmeler:** OpenAPI'de `/api/<service>/<entity>` list/create ve
  `/{id}` get/patch/delete; entity şemaları gerçek alanlardan türetilir. Entity yoksa
  servis başına generic `Item` fallback'i korunur.
- **Prisma:** `props.engine` → provider eşlemesi (postgres/mysql/sqlite/sqlserver/mongodb/
  cockroachdb), entity modelleri tipli kolonlar, `createdAt`/`updatedAt` davranışı,
  ilişki scalar kolonları ve `@@index`.
- **Gerçek tokenizer:** `packages/core/src/tokenizer.ts` → `gpt-tokenizer` (cl100k_base).
  `estimateTokens` artık BPE sayımı yapıyor.
- **Dürüst metrikler:** `context_slice_ratio` tüm paket (state + görevler + index + üretilen
  artifact'lar) üzerinden ölçülüyor; `parallel_groups` hedefi `min(3, node−1)`;
  `deterministic_coverage` paketteki artifact türlerinin doğrulanma oranı;
  yeni `deterministic_checks` metriği gerçek kontrol sayısını raporluyor.
- **Güçlü doğrulama:** benzersiz `operationId`, cevaplar, `$ref` çözümü, JSON Schema
  yapısal kontrolü (`required` ↔ `properties`, `items`, tipler), görev dosyası bütünlüğü
  (paketleme sırasında), OpenCode ajan frontmatter/steps, ADR ve manifest kontrolleri.
- **Yapılandırılabilir verify:** `packageManager` (pnpm/npm/yarn/bun) × `testRunner`
  (vitest/jest/node). CLI, HTTP API ve web UI'dan seçilebilir; bilinmeyen değer 400.
- **LLM sağlamlaştırması:** prompt domain entity şemasını içeriyor; dönen state
  `sanitizeState` ile duplicate/dangling/self-loop temizliğinden geçiyor; şema veya
  döngü hatasında bir kez daha deneniyor.
- **HTTP API:** `POST /api/preview` (ZIP yok), `POST /api/generate`, `state` import,
  `GET /api/version`, IP başına rate limit (429 + `Retry-After`), 256 KB gövde limiti,
  güvenlik header'ları, anlamlı hata kodları.
- **Web UI:** önizleme tabloları (bileşen/entity/görev/metrik/doğrulama), ArchState JSON
  importu, hedef runtime seçimleri, indirme özeti.
- **CLI:** `--preview`, `--extract`, `--package-manager`, `--test-runner`, path traversal
  korumalı çıkarma.
- **Altyapı:** `Dockerfile` + healthcheck, `.dockerignore`, `.env.example`, MIT `LICENSE`,
  GitHub Actions CI (typecheck + test + docker build), `examples/architecture.json`.

## 4. Dosya yapısı

```
architect-studio/
├─ package.json                 # script'ler ve kök bağımlılıklar (v0.2.0)
├─ pnpm-workspace.yaml
├─ tsconfig.json                # CommonJS, ES2022, strict, noEmit
├─ vitest.config.ts
├─ Dockerfile / .dockerignore
├─ .env.example / LICENSE
├─ .github/workflows/ci.yml
├─ examples/architecture.json
├─ README.md
├─ PROJECT-SUMMARY.md
├─ web/index.html               # form + önizleme + JSON import
├─ .opencode/agents/            # bu repo için implementer/validator/reviewer
├─ docs/superpowers/
│  ├─ specs/2026-11-22-agent-package-design.md
│  └─ plans/2026-11-22-usable-mvp.md
├─ .superpowers/sdd/progress.md # görev/commit ledger'ı
└─ packages/
   ├─ core/                     # state, diff, ids, metrics, tokenizer, task-packet
   │  ├─ src/{state,diff,ids,metrics,tokenizer,task-packet}.ts
   │  └─ tests/{state,diff,task-packet}.test.ts
   ├─ generators/               # openapi, prisma, asyncapi, mermaid, docs/ADR
   │  ├─ src/{openapi,prisma,asyncapi,mermaid,docs,util,index}.ts
   │  └─ tests/ + tests/fixtures/{minimal,ecommerce,domain}.json
   ├─ validators/               # deterministik doğrulama + self-heal
   │  └─ src/{index,self-heal}.ts + tests/
   ├─ packager/                 # ZIP, metrics, MANIFEST, OpenCode agents, redaction
   │  └─ src/{build-package,opencode-agents,report,zip,index}.ts + tests/
   └─ app/                      # demo/LLM üretici, pipeline, HTTP server, CLI
      └─ src/{demo,llm,pipeline,server,cli}.ts + tests/{app,server}.test.ts
```

`out/` ve `*.zip` git'e girmez; üretilen paketler geçicidir.

## 5. Doğrulanmış sonuçlar

| Kontrol | Sonuç |
|---|---|
| `pnpm test` | 74/74 test geçti |
| `pnpm typecheck` | temiz |
| Referans mimari (`postgres redis react api`) | 18/18 metrik, doğrulama ok, 4 görev |
| Domain mimarisi (`domain.json`, 3 node / 2 entity) | 18/18 metrik, doğrulama ok |
| Minimal mimari (2 node) | 18/18 metrik |
| İçe aktarılan state (`examples/architecture.json`) | paket + önizleme çalışıyor |
| Eşzamanlı 3 önizleme isteği | state sızıntısı yok, hepsi 200 |
| Rate limit | 2. istekte 429 + `Retry-After` |
| Docker image build | CI'da doğrulanır (yerelde Docker varsa `docker build -t architect-studio .`) |

Test dağılımı: core 26, generators 10, validators 10, packager 8, app 10, server 10.

## 6. Kalan sınırlar (bilinçli)

### Üretim kalitesi
- Görev metinleri node türüne göre şablonlanır; LLM yalnızca mimari state'i üretir.
- OpenAPI entity CRUD'u üretir ama gerçek iş kurallarını/validasyonlarını modellemez.
- Kabul kriterleri üretilir, hedef kod tabanında çalıştırılmaz.
- `verifyCommand` hedef projede ilgili runner'ın kurulu olmasını varsayar.

### Doğrulama / metrikler
- JSON Schema kontrolü yapısaldır; tam OpenAPI/AsyncAPI 3.1 meta-şema doğrulaması değildir.
- `duplicate_context_ratio` yalnızca birebir aynı context'i yakalar (normalize edilmiş
  kısmi örtüşmeyi ölçmez).
- `state_to_package_ms` tek istek süresidir; p95 için yük testi yoktur (eşzamanlılık testi var).

### Ürün / altyapı
- Kimlik doğrulama, kullanıcı/oturum, kalıcılık yok; sunucu tek süreç ve in-memory
  (spesifikasyonda bilinçli non-goal).
- Rate limit in-memory ve süreç başına; çok örnekli dağıtımda paylaşılmaz.
- Tarayıcı E2E (Playwright) yok; indirme akışı HTTP seviyesinde test edilir.
- Arayüz metinleri Türkçe, backend hata mesajları İngilizce.
- `web/index.html` `process.cwd()` üzerinden okunur; sunucu repo kökünden çalıştırılmalı.

## 7. Yeni geliştirici için ilk adımlar

1. `pnpm test && pnpm typecheck` ile başla.
2. `pnpm dev` + tarayıcıda demo moduyla hem önizle hem ZIP indir.
3. `pnpm generate -- --json examples/architecture.json --extract out/package` ile çıktıyı incele.
4. Gerçek bir OpenAI-uyumlu endpoint ile BYOK akışını manuel dene (anahtarı commit etme).
5. Sonraki iyileştirme adayları:
   - Playwright ile gerçek indirme E2E testi.
   - Tam OpenAPI/AsyncAPI meta-şema doğrulaması (ajv + spec şemaları).
   - Kabul kriterlerini hedef repoda çalıştıran doğrulama ajanı.
   - Kalıcılık/çok kullanıcılı oturumlar (bilinçli olarak kapsam dışıydı).
   - Normalize edilmiş kısmi context tekrarı ölçümü.

## 8. Faydalı komutlar

```bash
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm build

# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Mevcut state'ten paket + dizine açma
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Sadece önizleme
pnpm generate -- --json examples/architecture.json --preview

# BYOK + hedef runtime
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini \
  --package-manager npm --test-runner jest

# Docker
docker build -t architect-studio .
docker run --rm -p 3000:3000 --env-file .env.example architect-studio
```
