# AI Principal Architect — v2.0.0

Fikrini (veya mevcut bir projeni), OpenCode/Cursor/Claude gibi kodlama ajanlarının düşük
token ile inşa edebileceği **doğrulanmış bir ajan paketine** çeviren açık kaynak, BYOK
tabanlı araç.

## Ne yapar?

1. Doğal dildeki fikri alır, mevcut bir `ArchState` JSON'u içe aktarır **veya mevcut bir
   repoyu tersine mühendislikle analiz eder**.
2. Mimari state'i üretir: bileşenler, bağlantılar, kararlar ve **domain entity'leri**.
3. OpenAPI 3.1 (entity CRUD), Prisma, AsyncAPI 2.6, Mermaid, `ARCHITECTURE.md`,
   `WHITEPAPER.md` ve ADR'leri üretir.
4. Her artifact'ı deterministik olarak doğrular; onarılabilir hataları LLM'siz düzeltir.
5. Görevleri `TASKS.md` dizini + `tasks/T-*.md` dilimlenmiş paketlerine böler.
6. Paketi **sabit bellekle akan** bir ZIP olarak üretir.
7. İstenirse paketi izole bir sandbox içinde doğrular.
8. `.opencode/agents/{implementer,validator,reviewer}.md`, `metrics.json` ve
   `MANIFEST.md` ile birlikte teslim eder.

## v2.0 yetenekleri

| Yetenek | Özet |
|---|---|
| **Stream ZIP** | Node `Readable` + backpressure; arşiv tek buffer'a alınmaz. 24 MB'lık paket profili testte doğrulanır. |
| **8 dil** | `tr`, `en`, `de`, `es`, `fr`, `pt`, `ja`, `zh`; Web UI, API hataları ve üretilen dokümanlar seçilen dilde. |
| **Frontend Studio** | Dil seçici, canlı Mermaid, dosya ağacı + içerik, görev/metrik/doğrulama sekmeleri, state düzenleme, indirme. |
| **REA** | `repoToState`: `package.json`, workspace'ler, Prisma, `docker-compose`, ADR'ler ve bileşen dosyalarından `ArchState`. |
| **Multi-Sandbox** | `temp-dir`, `bwrap`, `podman`, `docker`, `firejail`, `systemd-run`; otomatik algılama ve güvenli fallback. |
| **MCP** | `architect_generate`, `architect_preview`, `architect_validate`, `architect_reverse_engineer`. |
| **Web arama** | Tavily/Brave anahtarıyla veya anahtarsız DuckDuckGo fallback'iyle güncel referanslar. |

## Hızlı başlangıç

```bash
pnpm install
pnpm dev
# http://localhost:3000
```

Demo modu varsayılan olarak açıktır; API anahtarı gerektirmez. Node >= 22 ve pnpm gerekir.

### BYOK

Arayüzde demo modunu kapat; API anahtarı, model ve OpenAI-uyumlu base URL gir. Anahtar
yalnızca istek süresince kullanılır; diske yazılmaz, loglanmaz ve pakete konmaz.

## Web Studio

- Fikir formu, demo/BYOK alanları, hedef **paket yöneticisi** ve **test runner**.
- Üst menüde **8 dilli seçici**; seçim API isteklerine ve üretilen dokümanlara yansır.
- **Proje analizi (tersine mühendislik):** yerel bir dizin yolu gir, `ArchState` otomatik
  çıkarılsın, state düzenleyiciye yüklensin ve önizlensin.
- **Önce önizle:** canlı Mermaid diyagramı, dosya ağacı + dosya içeriği, görev tablosu,
  metrikler ve doğrulama sorunları; ZIP indirmeden.
- **Sandbox doğrulaması:** seçilen sürücüde paket materyalize edilip kontrol edilir.
- **Canlı web araması:** mimari tasarlanmadan önce güncel API/kütüphane referansları eklenir.
- **ArchState JSON** yapıştırarak veya düzenleyerek mevcut mimariyi paketleyebilirsin.

## Dil desteği (i18n)

Tek kaynak `packages/core/src/i18n/locales/en.ts`; diğer diller `MessageKey` parity'siyle
derlenir. `Accept-Language` başlığı, gövdedeki `locale` alanı ve CLI `--locale` aynı
kataloğu kullanır. Eksik çeviri İngilizceye düşer, placeholder'lar korunur.

## Tersine mühendislik (REA)

`packages/reverse` içindeki `repoToState(root)` şunları tarar:

- kök ve workspace `package.json` dosyaları → framework, veritabanı, kuyruk ve dış servisler,
- `prisma/schema.prisma` → entity'ler, alanlar, primary/unique ve ilişkiler,
- `docker-compose.y(a)ml` / `compose.y(a)ml` → servis, veritabanı ve kuyruk düğümleri,
- `docs/adr/**`, `adr/**`, `decisions/**` → ADR kararları,
- `src/app|pages|components` altındaki bileşen dosyaları → UI düğümü (framework yoksa).

`node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `vendor`, `target` gibi dizinler
ve 512 KB üstü dosyalar atlanır. Sonuç `validateState` ile doğrulanır ve doğrudan
paketlenebilir. CLI: `--reverse <dir>`, API: `POST /api/reverse`, Studio: proje analizi paneli.

## Sandbox sürücüleri

`packages/sandbox` modüler bir `SandboxDriver` arayüzü sunar. Her sürücü komutu izole bir
geçici çalışma dizininde, yalnızca güvenli ortam değişkenleriyle (`PATH`, `LANG`, `HOME`,
`TMPDIR`; API anahtarları geçmez) çalıştırır.

| Tür | İzolasyon | Gereksinim |
|---|---|---|
| `temp-dir` | Dizin + kısıtlı env | Her zaman kullanılabilir |
| `bwrap` | Linux namespace | Bubblewrap |
| `podman` | Rootless konteyner | Podman + `node:22-alpine` imajı |
| `docker` | Konteyner | Docker + imaj |
| `firejail` | Süreç jail'i | Firejail |
| `systemd-run` | Geçici systemd scope | systemd kullanıcı oturumu |

`auto` sırası: `bwrap → podman → docker → firejail → systemd-run → temp-dir`. Kurulu
olmayan bir sürücü açıkça seçilirse net hata döner; `fallback` etkinse `temp-dir`'e düşer.
CLI `--sandbox <tür>` / `--sandbox-command <cmd>`, API `POST /api/sandbox`, Studio'daki
sandbox seçici aynı sürücüleri kullanır. `GET /api/sandboxes` kurulu motorları ve
sürümlerini listeler.

## MCP sunucusu

```bash
pnpm mcp
```

Dört araç stdio üzerinden sunulur: `architect_generate`, `architect_preview`,
`architect_validate`, `architect_reverse_engineer`. Claude Code, Cursor, OpenCode ve
Freebuff yapılandırma örnekleri: [`docs/mcp.md`](docs/mcp.md).

## Web araması

`ideaToState`'ten önce opsiyonel bir arama katmanı çalışır. Sağlayıcı `auto` iken
`TAVILY_API_KEY` veya `BRAVE_API_KEY` varsa o servis, yoksa anahtarsız DuckDuckGo
instant-answer API'si kullanılır. Sonuçlar 4.000 karakterle sınırlı bir bağlam bloğu
olarak prompt'a eklenir. CLI `--web-search --search-provider <auto|tavily|brave|duckduckgo>`,
API gövdesinde `webSearch: true`, Studio'da "Canlı web araması" anahtarı.

## HTTP API

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/api/health` | `{ ok, version }` |
| GET | `/api/version` | Sürüm, tokenizer ve diller |
| GET | `/api/i18n?locale=tr` | Mesaj kataloğu |
| GET | `/api/sandboxes` | Algılanan sandbox sürücüleri |
| POST | `/api/preview` | State + diyagram + dosyalar + görevler + metrikler + doğrulama |
| POST | `/api/generate` | ZIP (`application/zip`, `Content-Length` akıştan ölçülür) |
| POST | `/api/reverse` | `{ path }` → `ArchState`, bulgular, özet |
| POST | `/api/sandbox` | Paketi seçilen sandbox'ta doğrular |

Ortak gövde alanları: `idea` **veya** `state`, `demo`, `apiKey`, `baseUrl`, `model`,
`packageManager`, `testRunner`, `locale`, `sandbox`, `webSearch`. İstek gövdesi 256 KB ile
sınırlıdır; yazma uçları IP başına dakikalık bütçeyle korunur (`RATE_LIMIT_PER_MIN`,
varsayılan 120). Hata kodları: `400` geçersiz girdi/state/path/sandbox, `413` gövde çok
büyük, `429` rate limit, `502` LLM sağlayıcı hatası.

## CLI

```bash
# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Mevcut state'ten paket + dizine aç
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Tersine mühendislik + sandbox doğrulaması
pnpm generate -- --reverse ../my-project --sandbox auto --out out/reverse.zip

# Türkçe çıktı + canlı web araması
pnpm generate -- --idea "..." --demo --locale tr --web-search --search-provider auto

# BYOK + hedef runtime
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini \
  --package-manager npm --test-runner jest

# Sadece önizleme (ZIP yazmaz)
pnpm generate -- --json examples/architecture.json --preview
```

Bayraklar: `--out`, `--extract`, `--base-url`, `--sandbox`, `--sandbox-command`,
`--web-search`, `--search-provider`, `--help`.

## Paket içeriği

- `ARCHITECTURE.md` (bileşenler + domain modeli + diagram), `WHITEPAPER.md`, `AGENTS.md`, `.cursorrules`
- `adr/ADR-*.md`
- `TASKS.md` ve `tasks/T-*.md` (kendi kendine yeterli görev paketleri)
- `.opencode/agents/{implementer,validator,reviewer}.md`
- `openapi.yaml`, `asyncapi.yaml`, `prisma/schema.prisma`, `diagram.mmd`
- `metrics.json`, `MANIFEST.md`

## Bellek profili

ZIP, `JSZip.generateNodeStream` çıktısının Node `PassThrough`'a köprülenmesiyle üretilir;
boyut, arşiv belleğe alınmadan sayan bir `Writable` üzerinden ölçülür. `build-package`
token metriğini dosya dosya hesaplar (tüm artifact'ları tek string'de birleştirmez).
`packages/packager/tests/memory.test.ts` 24 MB'lık, sıkıştırılamayan bir paketi
`--expose-gc` ile ayrı süreçte profiller: canlı heap yükün yarısının altında kalır ve tek
parça 4 MB'ı geçmez.

## Metrikler

Token sayımı gerçek BPE tokenizer (`gpt-tokenizer`) ile yapılır.

| Metrik | Hedef |
|---|---|
| `packet_prompt_tokens_p95` | ≤ 1500 |
| `packet_prompt_tokens_max` | ≤ 2500 |
| `context_slice_ratio` | ≤ 0.10 |
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

## Testler

```bash
pnpm test        # 128 test, 15 dosya
pnpm typecheck
pnpm build       # typecheck + test
```

Kapsam: core/state/diff/task-packet, 8 dilli i18n, generator'lar, doğrulayıcılar, packager,
stream ZIP bellek profili, 54 düğümlü stres + fuzz + eşzamanlı indirme, HTTP API, tersine
mühendislik, sandbox sürücüleri, web arama ve MCP araçları.

## Docker

```bash
docker build -t architect-studio .
docker run --rm -p 3000:3000 --env-file .env.example architect-studio
```

`/api/health` üzerinden healthcheck tanımlıdır. Sandbox konteynerleri için Docker/Podman
soketinin konteynere verilmesi gerekir; `temp-dir` ve `bwrap` bu gereksinimi duymaz.

## CI

`.github/workflows/ci.yml`: pnpm + Node 22 ile `typecheck`, `test` ve Docker image build.

## Bilinçli sınırlar

- Kimlik doğrulama, kullanıcı/oturum ve kalıcılık yoktur; sunucu tek süreç ve in-memory'dir.
- Görev metinleri node türüne göre şablonlanır; LLM yalnızca state üretir.
- Kabul kriterleri üretilir, hedef kod tabanında çalıştırılmaz.
- Sandbox, komut çalıştırma izolasyonu sağlar; `podman`/`docker` imajının önceden
  çekilmiş olması gerekir.
- Tarayıcı E2E (Playwright) yoktur; indirme akışı HTTP seviyesinde test edilir.
- Web araması `auto` modunda anahtarsız DuckDuckGo'ya düşer; sonuç kalitesi sağlayıcıya bağlıdır.

## Tasarım ve plan

- `docs/superpowers/specs/2026-11-22-agent-package-design.md`
- `docs/superpowers/plans/2026-11-22-usable-mvp.md`
- `docs/mcp.md` — MCP araçları ve istemci yapılandırmaları
- `PROJECT-SUMMARY.md` — geliştirici devir notu
