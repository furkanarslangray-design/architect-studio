> **Dil / Language:** [Türkçe](README.tr.md) | [English](README.md)

# AI Principal Architect — v2.1.0

Fikrini (veya mevcut bir projeni), OpenCode/Cursor/Claude gibi kodlama ajanlarının düşük
token ile inşa edebileceği **doğrulanmış bir ajan paketine** çeviren açık kaynak, BYOK
tabanlı araç.

## Ne yapar?

1. Doğal dildeki fikri alır, mevcut bir `ArchState` JSON'u içe aktarır **veya** mevcut bir
   repoyu tersine mühendislikle analiz eder.
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
| **8 dil** | `tr`, `en`, `de`, `es`, `fr`, `pt`, `ja`, `zh`; API hataları ve üretilen dokümanlar seçilen dilde. |
| **Studio sözleşmesi** | Arayüz kodu depoda tutulmaz; 11 ekran, bileşen/etkileşim listesi, tasarım token'ları ve tam API sözleşmesi [`FRONTEND_SPEC.md`](FRONTEND_SPEC.md) içindedir. |
| **REA** | `repoToState`: `package.json`, workspace'ler, Prisma, `docker-compose`, ADR'ler ve bileşen dosyalarından `ArchState`. |
| **Multi-Sandbox** | `temp-dir`, `bwrap`, `podman`, `docker`, `firejail`, `systemd-run`; otomatik algılama ve güvenli fallback. |
| **MCP** | `architect_generate`, `architect_preview`, `architect_validate`, `architect_reverse_engineer`. |
| **Web arama** | Tavily/Brave anahtarıyla veya anahtarsız DuckDuckGo fallback'iyle güncel referanslar. |
| **Nx monorepo** | 9 proje, `nx run-many` ile önbellekli `test`/`typecheck`, `nx graph` mimari haritası ve yerel `package` generator'ı. |

## Hızlı başlangıç

```bash
pnpm install
pnpm architect init .   # .architect/config.json + istemci MCP dosyaları + AGENTS.md bloğu
pnpm dev          # nx run app:dev → http://localhost:3000
pnpm test         # nx run-many -t test
pnpm typecheck    # nx run-many -t typecheck
pnpm nx graph     # mimari harita (proje grafiği), http://127.0.0.1:4211
```

Demo modu varsayılan olarak açıktır; API anahtarı gerektirmez. Node **24.22.1** (`.nvmrc`)
ve pnpm 10 gerekir; depo kökünde `nvm use` / `fnm use` doğru sürümü seçer.

Sunucu **yalnızca HTTP API** sunar. Studio arayüzünün kaynak dosyaları (`web/*`) depoda
yoktur; arayüz `FRONTEND_SPEC.md` sözleşmesine göre ayrıca yazılır. Bu yüzden `GET /`,
arayüz dosyası yokken `200` + `application/json` ile `api-only` modunda bir karşılama
yanıtı döner (ad, sürüm, `FRONTEND_SPEC.md` referansı ve aktif `/api/*` uç listesi);
`GET /api/*` uçlarının tamamı çalışır.

### Node sürümü / rea launcher'ı

`rea-agents` launcher'ı kendi `engines` alanında Node **`^22.23.4 || ^24.22.1 || >=26.12.1`**
ister; REA köprüsü bu sürümlerin dışında çalışmaz ve `rea.engine` sessizce `static`'e düşer.
Bu yüzden gereksinim depo seviyesinde sabitlendi:

| Yer | Değer |
|---|---|
| `.nvmrc` | `24.22.1` |
| `package.json` → `engines.node` | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` |
| `.github/workflows/ci.yml` | `actions/setup-node` → `node-version-file: .nvmrc` |

```bash
nvm install && nvm use      # .nvmrc → 24.22.1
node -v                     # v24.22.1
pnpm install                # engines uyarısı çıkmamalı
```

Sürüm tutmuyorsa `pnpm install` `Unsupported engine` uyarısı verir; bu durumda ya Node'u
yükselt ya da REA köprüsünü tamamen atla (`useRea` vermeden çalıştır, `rea.engine: "static"`).
Sistem Node'u eskiyse ve yükseltmek istemiyorsan `ARCHITECT_REA_BIN=/path/to/rea` ile
yalnızca o süreci farklı bir Node ile çalıştırabilirsin.

### BYOK

İstemci demo modunu kapatır; API anahtarı, model ve OpenAI-uyumlu base URL istek gövdesinde
(`apiKey`, `model`, `baseUrl`) gönderilir. Anahtar yalnızca istek süresince kullanılır;
diske yazılmaz, loglanmaz ve pakete konmaz.

## Arayüz sözleşmesi (`FRONTEND_SPEC.md`)

Studio arayüzü bu depoda kod olarak bulunmaz; sözleşmesi kök dizindeki
[`FRONTEND_SPEC.md`](FRONTEND_SPEC.md) dosyasındadır ve backend ona göre sabitlenmiştir:

- **5 bölüm:** ürün özeti/akışlar, ekran + bileşen/etkileşim listesi, tasarım sistemi
  (HEX palet, tipografi, dark/light, layout, responsive), tam API sözleşmesi, hata ve
  yüklenme durumları.
- **11 ekran/bileşen:** `IdeaComposer`, `ArchitectureCanvas` (Mermaid), `EntityTable`,
  `ChatPanel`, `TaskBoard`, `MetricsGrid`, `ValidationPanel`, `ArtifactExplorer`,
  `ReverseForm`, `SandboxPanel`, `SettingsDrawer`.
- **Bağlandığı uçlar:** `GET /api/health|version|i18n|sandboxes|rea`,
  `POST /api/preview|chat|generate|reverse|sandbox`.
- Arayüz yeni bir uç nokta gerektirmez; sözleşme mevcut backend ile birebir eşleşir.

Mimari sohbeti (`POST /api/chat`) doğal dil komutlarını (`Redis cache ekle`,
`Order entity'sine status alanı koy`, `Mikroservislere böl`) deterministik olarak
`ArchState`'e uygular; BYOK modunda LLM devreye girer, hata verirse deterministik motora
düşer. Alan ekleme yalnızca açık alan ifadesi, tip belirten identifier veya
camelCase/snake_case identifier ile tetiklenir; "ekle" geçen her cümle alan sayılmaz.
Mikroservis bölme yalnızca `mikroservis`/`microservices` ya da servis kelimesi +
`böl|split|ayır` ile çalışır.

## Nx çalışma alanı

Depo, Nx 24 üzerinde pnpm workspace olarak yapılandırılmıştır. Her paket kendi
`project.json` (`typecheck`, varsa `test` hedefleri) ve `tsconfig.json` dosyasına sahiptir;
ortak derleyici ayarları `tsconfig.base.json` içindedir.

| Proje | Rol |
|---|---|
| `core` | state, diff, i18n, tokenizer, metrikler, task packet |
| `generators` | OpenAPI / Prisma / AsyncAPI / Mermaid / doküman üreticileri |
| `validators` | deterministik doğrulama + self-heal |
| `packager` | stream ZIP, metrikler, manifest, OpenCode ajanları |
| `app` | pipeline, sohbet, web arama, HTTP sunucusu, CLI |
| `reverse` | `repoToState` + morluto/rea köprüsü |
| `sandbox` | çoklu sandbox sürücüleri |
| `mcp` | MCP araçları + stdio sunucusu |
| `nx-plugin` | yerel Nx generator'ları (bkz. aşağıdaki bölüm) |

```bash
pnpm test                      # nx run-many -t test (önbellekli)
pnpm typecheck                 # nx run-many -t typecheck
pnpm build                     # typecheck + test
pnpm affected                  # nx affected -t typecheck test (defaultBase: main)
pnpm nx graph --host 127.0.0.1 --port 4211   # canlı proje grafiği
pnpm nx graph --file=graph.html              # statik grafik çıktısı
pnpm nx show projects          # proje listesi
pnpm nx run app:dev            # tek proje hedefi
```

`nx.json` içinde `useDaemonProcess: false` (CI/konteyner dostu), `analytics: false` ve
`test`/`typecheck` hedefleri için `cache: true` ayarlıdır. Görev çıktıları `.nx/` altında
tutulur ve bu dizin git'e girmez.

Paketler birbirini göreli yolla (`../../core/src/state`) import ettiği için Nx bağımlılık
kenarlarını kendiliğinden çıkarmaz; gerçek bağımlılıklar her `project.json` içindeki
`implicitDependencies` alanında bildirilir ve `nx graph` haritası bu kenarları gösterir.

### Yerel Nx generator'ı

`packages/nx-plugin`, `@architect-studio/workspace-plugin` adıyla bir Nx plugin'idir
(`generators.json` + `tsconfig.base.json` içindeki path eşlemesi). Yeni bir kütüphane
paketini depo kurallarıyla (project.json hedefleri, tsconfig, kaynak, Vitest paketi)
üretir:

```bash
pnpm nx g @architect-studio/workspace-plugin:package order-flow \
  --description="Order flow orchestration"

# Önizleme: hiçbir dosya yazılmaz
pnpm nx g @architect-studio/workspace-plugin:package order-flow --dry-run
```

Üretilen dosyalar: `packages/<ad>/project.json`, `packages/<ad>/tsconfig.json`,
`packages/<ad>/src/index.ts`, `packages/<ad>/tests/<ad>.test.ts`. Geçersiz ad (kebab-case
değil) ve var olan paket adı reddedilir.

### `architect init`

Hedef repoyu tek komutla MCP sunucusuna bağlar:

```bash
pnpm architect init .                     # tüm istemciler
pnpm architect init . --client opencode   # tek istemci
pnpm architect init . --force             # mevcut dosyaların üzerine yaz
```

Yazdıkları: `.architect/config.json` (istemci, MCP komutu, `reverseRoots`, paket/test
çalıştırıcı), `.cursor/mcp.json`, `.mcp.json`, `opencode.json` ve `AGENTS.md` içindeki
`<!-- architect:start --> … <!-- architect:end -->` bloğu. Komut **idempotenttir**: ikinci
koşu hiçbir dosyayı değiştirmez (hepsi `unchanged` raporlanır), `AGENTS.md`'de yalnızca
kendi bloğunu günceller ve sahibi olmadığı dosyalara `--force` verilmeden dokunmaz.
Freebuff için dosya yazmaz, MCP ekranından ekleme notu düşer.

### `architect doctor`

Kaydedilmiş mimari (`.architect/state.json`) ile deponun bugünkü halini karşılaştırır:

```bash
pnpm architect doctor .                  # insan okunur rapor
pnpm architect doctor . --json           # makine okunur rapor
pnpm architect doctor . --fail-on-drift  # kayma varsa çıkış 1 (CI için)
pnpm architect doctor . --state out/state.json
pnpm architect doctor . --write         # deponun bugünkü halini .architect/state.json'a yaz
```

Drift türleri: `node`, `edge`, `entity`, `field`, `decision` × `added|removed|updated`. State
dosyası yoksa veya bozuksa çıkış **2**, temizse **0**, `--fail-on-drift` ile kayma varsa **1**.
`validateState` hataları da rapora düşer. Sınır: üretilmiş `openapi.yaml`/`ARCHITECTURE.md`
geri ayrıştırılmaz; karşılaştırma yapısaldır ve rapor bunu not olarak yazar. `--write`
state dosyasını üretir (yoksa oluşturur, varsa tazeler); tipik akış `doctor --write` → düzenle →
`doctor --fail-on-drift`.

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
paketlenebilir. CLI: `--reverse <dir>`, API: `POST /api/reverse`, arayüz: `ReverseForm`
(`FRONTEND_SPEC.md` §2.2).

### morluto/rea köprüsü

`--use-rea` (API'de `useRea: true`, MCP'de `useRea`) [`morluto/rea`](https://github.com/morluto/rea)
ile köprü kurar:

- `rea` veya `rea-agents` PATH'te varsa `rea analyze-javascript-application <path> --json`
  (gerekirse `rea analyze` / `rea inspect`) çalıştırılır; stdout 54 KB'lık bir
  `--filter-output` projeksiyonundan geçirilir (tam zarf ~34 MB), REA'nın
  `normalized_result` dokümanı modül/asset/paket/endpoint/Electron bulgularına çevrilir.
- Kurulu değilse yerleşik analizör devreye girer: dosya imzaları (ELF/PE/Mach-O/WASM/SQLite),
  Electron `.asar` başlığı, minified bundle imzaları, `.env.example` anahtar adları (değerler
  okunmaz), Dockerfile taban tabanı ve dış endpoint'ler. Bulgular aynı `evidence` şemasındadır,
  böylece alt katman hangi motorun çalıştığını bilmek zorunda kalmaz.
- Belirli bir kurulumu işaret etmek için `ARCHITECT_REA_BIN=/path/to/rea` kullan.
  `rea-agents` launcher'ı Node `^22.23.4 || ^24.22.1 || >=26.12.1` ister; bu yüzden depo
  kökünde `.nvmrc` = `24.22.1` ve `package.json` → `engines.node` aynı aralık sabittir
  (ayrıntı: [Node sürümü](#node-sürümü--rea-launcherı)).
- REA bulguları `mergeReaFindings` ile `ArchState`'e katılır: veritabanı, kuyruk ve dış servis
  düğümleri kanıt yollarıyla (`props.evidence`) eklenir; mevcut adlar tekrar eklenmez.
- Yanıtta motor `rea.engine` (`rea` | `rea-agents` | `static`), `rea.findings`,
  `rea.scannedArtifacts` ve `rea.warnings` (REA sınırlamaları) döner. `GET /api/rea`
  yalnızca algılama sonucunu verir.

### Artımlı reverse (içerik-hash önbelleği)

`repoToStateCached`, sonucu dosya envanterinin (yol, boyut, mtime) + analizörün gerçekten
okuduğu dosyaların SHA-256 içeriğinin (manifestler, Prisma, Compose, ADR, `.env.example`,
Dockerfile; ≤64 KB) + sonucu etkileyen seçeneklerin (yol tabanı, `useRea`, `maxFiles`,
`maxDepth`, `ignore`) hash'iyle anahtarlar. Anahtar aynıysa sonuç
`.architect/cache/reverse/<key>.json` dosyasından okunur: manifest parse, merge, doğrulama ve
`rea` alt süreci tamamen atlanır; yanıtta `cacheHit: true` döner.

- `POST /api/reverse { cache: false }` önbelleği atlar; başka bir dizin için
  `ARCHITECT_CACHE_DIR`, kapatmak için `REVERSE_CACHE=0` kullanılır. TTL 24 saattir.
- Girdiler değiştiğinde (manifest içeriği, dosya eklenmesi/silinmesi, seçenekler) anahtar
  değişir, ilk istek yeniden hesaplar.
- `.architect/cache/` git'e girmez.
- **Ölçüm** (bu makine, `tsx`): 391 dosyalık fixture (8 Prisma modeli, Compose, 5 ADR, 380
  component) cold **104,9 ms** → warm medyan **16,3 ms** = **6,4x**; bu depo (125 dosya)
  60,3 ms → 9,5 ms = 6,3x; manifest düzenlenince `cacheHit: false` ile yeniden hesaplanır.
- **CPU/RAM optimizasyonu** (aynı fixture): tek dizin yürüyüşü (`inventory` ile ön tarama
  yeniden kullanılır), `stat` sonucundan `mtimeMs` (ikinci syscall yok), içerik özeti memo'su
  (4096 giriş), süreç içi sonuç memo'su (4 giriş) ve `skipped` listesi 200 girdiyle sınırlı.
  Sonuç: soğuk **110,5 → 52,9 ms**, sıcak **18,7 → 5,8 ms**, sıcak yolda dosya okuması
  **12 → 0**, heap **10–14 MB → 11–13 MB** (düz).

### İlerleme akışı (SSE)

`POST /api/reverse/jobs` gövdesi `/api/reverse` ile aynıdır ve `202 { jobId, status, events }`
döner. `GET /api/reverse/jobs/<id>/events` `text/event-stream` olarak `scan → rea → merge →
validate → done|error` olaylarını akıtır; `done` olayının `payload` alanı `/api/reverse`
yanıtının tamamıdır. `GET /api/reverse/jobs/<id>` durumu ve tüm geçmişi verir; biten işler 5
dakika saklanır. Aynı kuyruk ve güvenlik sınırları geçerlidir.

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
CLI `--sandbox <tür>` / `--sandbox-command <cmd>`, API `POST /api/sandbox` ve arayüzdeki
`SandboxPanel` aynı sürücüleri kullanır. `GET /api/sandboxes` kurulu motorları ve
sürümlerini listeler.

## MCP sunucusu

```bash
pnpm mcp
```

Dört araç stdio üzerinden sunulur: `architect_generate`, `architect_preview`,
`architect_validate`, `architect_reverse_engineer` (`useRea: true` ile morluto/rea köprüsü).
Claude Code, Cursor, OpenCode ve Freebuff yapılandırma örnekleri: [`docs/mcp.md`](docs/mcp.md).

## Web araması

`ideaToState`'ten önce opsiyonel bir arama katmanı çalışır. Sağlayıcı `auto` iken
`TAVILY_API_KEY` veya `BRAVE_API_KEY` varsa o servis, yoksa anahtarsız DuckDuckGo
instant-answer API'si kullanılır. Sonuçlar 4.000 karakterle sınırlı bir bağlam bloğu
olarak prompt'a eklenir. CLI `--web-search --search-provider <auto|tavily|brave|duckduckgo>`,
API gövdesinde `webSearch: true`, arayüzde `SettingsDrawer`/`IdeaComposer` anahtarı
(`FRONTEND_SPEC.md` §2.2).

## HTTP API

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/` | Arayüz yokken `api-only` karşılama JSON'u (`name`, `version`, `mode`, `spec`, `endpoints`) |
| GET | `/api/health` | `{ ok, version }` |
| GET | `/api/version` | Sürüm, tokenizer ve diller |
| GET | `/api/i18n?locale=tr` | Mesaj kataloğu |
| GET | `/api/sandboxes` | Algılanan sandbox sürücüleri |
| POST | `/api/preview` | State + diyagram + dosyalar + görevler + metrikler + doğrulama |
| POST | `/api/generate` | ZIP (`application/zip`, `Content-Length` akıştan ölçülür) |
| GET | `/api/rea` | `rea` / `rea-agents` algılama sonucu (sürüm, mod) |
| POST | `/api/chat` | `{ state, message }` → güncel state, diyagram, dosyalar, değişiklik listesi |
| POST | `/api/reverse` | `{ path, useRea? }` → `ArchState`, bulgular, özet, REA raporu |
| POST | `/api/sandbox` | Paketi seçilen sandbox'ta doğrular |

Ortak gövde alanları: `idea` **veya** `state`, `demo`, `apiKey`, `baseUrl`, `model`,
`packageManager`, `testRunner`, `locale`, `sandbox`, `webSearch`. İstek gövdesi 256 KB ile
sınırlıdır; yazma uçları IP başına dakikalık bütçeyle korunur (`RATE_LIMIT_PER_MIN`,
varsayılan 120). Hata kodları: `400` geçersiz girdi/state/path/sandbox (ve `path_not_allowed`),
`413` gövde çok büyük, `429` rate limit (ve `reverse_busy`), `502` LLM sağlayıcı hatası,
`504` `reverse_timeout`.

### `/api/reverse` güvenlik sınırları

Uç nokta istemcinin adını verdiği dizini okur ve kimlik doğrulaması yoktur; bu yüzden üç
sınır birlikte uygulanır:

| Sınır | Değişken | Varsayılan | Davranış |
|---|---|---|---|
| Bağlanma adresi | `HOST` | `127.0.0.1` | Yalnızca yerel makine; ağa açıkken ve `REVERSE_ROOTS` boşken açılışta uyarı yazılır |
| Okunabilir kökler | `REVERSE_ROOTS` | *(boş)* | İki nokta ile ayrılmış dizin listesi; dışındaki yollar `400 path_not_allowed` |
| Eşzamanlılık | `REVERSE_CONCURRENCY` | `2` | Fazla istekler FIFO kuyruğa girer |
| Kuyruk bütçesi | `REVERSE_QUEUE_TIMEOUT_MS` | `30000` | Sırada bekleyen istek `429 reverse_busy` alır |
| İş bütçesi | `REVERSE_TIMEOUT_MS` | `120000` | Aşımda `504 reverse_timeout`; `rea` alt sürecine de aynı bütçe geçer |

Yol çözümlemesi `path.resolve` + `fs.realpath` ile yapılır: `..` segmentleri normalize edilir
ve sembolik bağlantılar çözüldükten sonra karşılaştırılır, yani izinli kök içindeki bir
symlink dışarıyı gösteriyorsa reddedilir. Reddedilen yollarda çözümlenmiş yol istemciye
döndürülmez. `REVERSE_ROOTS` boş bırakılırsa yerel kullanım geriye uyumlu kalır (her okunabilir
yol), ama `HOST` loopback dışına alındığında bu kombinasyon **kapanır**: sunucu isteği
`403 reverse_disabled` ile reddeder, çünkü kimlik doğrulaması olmayan bir uç dosya sistemini
sınırsız okumamalıdır. Uyarı açılışta, ret ise istek başında verilir.

### Deterministik paket

ZIP girdileri sabit zaman damgası (`1980-01-01T00:00:00Z`), sabit sıralama ve `0o644` modu ile
yazılır; `zip.sha256` arşivin baytlarından hesaplanır ve `X-Package-SHA256` başlığında döner.
`metrics.json` içindeki süre metriği `REPRODUCIBLE=1` (veya CLI'de `--reproducible`) ile
sıfırlanır, böylece iki koşu aynı hash'i verir:

```bash
pnpm architect --json state.json --out paket.zip --reproducible
pnpm architect --reverse . --out paket.zip --reproducible
```

Testler hem `store` hem `deflate` profilini, giriş tarih/modlarını ve ayrı süreçte üretilen
arşivlerin aynı hash'ini doğrular.

## CLI

```bash
# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Mevcut state'ten paket + dizine aç
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Tersine mühendislik + sandbox doğrulaması
pnpm generate -- --reverse ../my-project --use-rea --sandbox auto --out out/reverse.zip

# Türkçe çıktı + canlı web araması
pnpm generate -- --idea "..." --demo --locale tr --web-search --search-provider auto

# BYOK + hedef runtime
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini \
  --package-manager npm --test-runner jest

# Sadece önizleme (ZIP yazmaz)
pnpm generate -- --json examples/architecture.json --preview
```

Bayraklar: `--out`, `--extract`, `--base-url`, `--sandbox`, `--sandbox-command`,
`--web-search`, `--search-provider`, `--use-rea`, `--help`.

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
pnpm test        # nx run-many -t test — 243 test, 25 dosya, 8 paket
pnpm typecheck   # nx run-many -t typecheck — 9 proje
pnpm build       # typecheck + test
```

Kapsam: core/state/diff/task-packet, 8 dilli i18n, generator'lar, doğrulayıcılar, packager,
stream ZIP bellek profili, 54 düğümlü stres + fuzz + eşzamanlı indirme, HTTP API, tersine
mühendislik (REA zarfı + sahte CLI), sohbet niyetleri, sandbox sürücüleri, web arama ve MCP
araçları. `nx-plugin` generator'ı `nx g ... --dry-run` ve gerçek üretim + `tsc`/Vitest ile
elle doğrulanır. Sözleşme testleri (`packages/app/tests/contract.test.ts`) her ucu
`packages/app/src/contract.ts` şemasına karşı doğrular, ZIP başlıklarını bağlar ve
`FRONTEND_SPEC.md` §4'teki uç listesini `ENDPOINTS` ile iki yönlü karşılaştırır; spec'e uç
eklemek ya da uç kaldırmak testi kırar.

## Docker

```bash
docker build -t architect-studio .
# Depoyu /workspace'e bağla; imaj reverse için yalnızca burayı okur.
docker run --rm -p 3000:3000 -v "$PWD:/workspace" architect-studio
```

**İmajın varsayılanları güvenli:** `HOST=0.0.0.0` (yayınlanan porta erişim için) ve
`REVERSE_ROOTS=/workspace`. Yani `/api/reverse` konteynerin tüm dosya sistemini değil, yalnızca
bağladığın çalışma alanını okuyabilir; istekte `path: "/workspace/<repo>"` verilir. Bu
denklemin dışına çıkmak istersen `REVERSE_ROOTS`'u genişlet ya da `-e REVERSE_ROOTS=` ile
boşalt — boşaltırsan sunucu `HOST` loopback dışında olduğu için `/api/reverse` isteklerini
`403 reverse_disabled` ile reddeder. Ağa açık + allowlist'siz dosya okuma kombinasyonu
desteklenmez; aynı kural `docker` dışındaki kurulumlar için de geçerlidir.

`.env.example` artık `HOST` satırını **yorumda** tutar, böylece
`docker run --env-file .env.example` konteyner içinde loopback'e bağlanmaya zorlamaz (bu
kombinasyon port yayınlandığı hâlde sunucunun dışarıdan erişilemez olmasına yol açıyordu).
Farklı bir adres/port için açıkça geç: `-e HOST=0.0.0.0 -e PORT=8080`.

`/api/health` üzerinden healthcheck tanımlıdır. Sandbox konteynerleri için Docker/Podman
soketinin konteynere verilmesi gerekir; `temp-dir` ve `bwrap` bu gereksinimi duymaz.

## CI

`.github/workflows/ci.yml`: `.nvmrc` (Node 24.22.1) ile `typecheck`, `test` ve Docker image build.

## Bilinçli sınırlar

- Kimlik doğrulama, kullanıcı/oturum ve kalıcılık yoktur; sunucu tek süreç ve in-memory'dir.
- **Arayüz kodü yoktur:** `web/*` silindi, yerine `FRONTEND_SPEC.md` sözleşmesi geçti;
  `GET /` arayüz dosyası yokken `200` ile `api-only` karşılama JSON'u döner, tüm `/api/*`
  uçları çalışır.
- Görev metinleri node türüne göre şablonlanır; LLM yalnızca state üretir.
- Kabul kriterleri üretilir, hedef kod tabanında çalıştırılmaz.
- Sandbox, komut çalıştırma izolasyonu sağlar; `podman`/`docker` imajının önceden
  çekilmiş olması gerekir.
- Tarayıcı E2E (Playwright) yoktur; indirme akışı HTTP seviyesinde test edilir.
- Web araması `auto` modunda anahtarsız DuckDuckGo'ya düşer; sonuç kalitesi sağlayıcıya bağlıdır.
- `rea` CLI'ı Node `^22.23.4 || ^24.22.1 || >=26.12.1` ister; daha eski Node'da köprü
  yerleşik analizöre düşer (`rea.engine: "static"`). Sabitlenen sürüm `.nvmrc` (24.22.1) ve
  `package.json` → `engines.node` içinde; CI `.nvmrc`'ı okur, Docker imajı `node:24-alpine`.

## Tasarım ve plan

- `FRONTEND_SPEC.md` — Studio arayüzü sözleşmesi (ekranlar, tasarım sistemi, API, hata durumları)
- `docs/superpowers/specs/2026-11-22-agent-package-design.md`
- `docs/superpowers/plans/2026-11-22-usable-mvp.md`
- `docs/mcp.md` — MCP araçları ve istemci yapılandırmaları
- `PROJECT-SUMMARY.md` — geliştirici devir notu
