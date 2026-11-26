# PROJECT-SUMMARY — AI Principal Architect (v2.1.0)

Yeni geliştirici devir teslim notu. Son güncelleme: 2026-11-24.

## 1. Proje nerede?

**Klasör:** `/home/furkanarslangray/architect-studio` (bu çalışma kopyasında worktree)
**Branch:** `mvp` / `main` (çalışma dalı `freebuff/frontend-temizleme-ve-frontend-spec-olu-turma`)
**Durum:** v2.1.0 — Nx monorepo, sohbet motoru, morluto/rea köprüsü ve arayüz sözleşmesi
tamamlandı; `architect init`, `/api/reverse` güvenlik sınırları ve sözleşme testleri
eklendi; test/typecheck yeşil. Studio arayüzü kod olarak depoda yok, sözleşmesi
`FRONTEND_SPEC.md`.

```bash
pnpm install
pnpm architect init . # .architect/config.json + istemci MCP dosyaları + AGENTS.md bloğu
pnpm dev              # nx run app:dev → http://localhost:3000 (yalnızca API)
pnpm mcp              # stdio MCP sunucusu
pnpm nx graph         # mimari harita, http://127.0.0.1:4211
```

Gereksinim: Node 24.22.1 (`.nvmrc`; `engines.node` = `^22.23.4 || ^24.22.1 || >=26.12.1`),
pnpm 10. Bağımlılıklar: `gpt-tokenizer`, `jszip`, `yaml`, `zod`,
`@modelcontextprotocol/sdk`, `mermaid`; geliştirme için `nx`, `tsx`, `typescript`,
`vitest`, `rea-agents`.

## 2. Proje ne yapıyor?

Doğal dildeki bir fikri, içe aktarılan `ArchState` JSON'unu veya tersine mühendislikle
çıkarılan bir mimariyi alır; doğrulanmış bir **ajan paketi** (ZIP) üretir.

```text
idea / ArchState / repository
  ──> (opsiyonel web search)
  ──> ideaToState() / parseState() / repoToState()
  ──> ArchState { nodes, edges, decisions, entities }
  ──> buildPackage()
        ├─ generators (OpenAPI / Prisma / AsyncAPI / Mermaid / docs / ADR)
        ├─ task packets (TASKS.md + tasks/T-*.md) — 8 dilde
        ├─ OpenCode agents
        ├─ validators (+ self-heal)
        ├─ metrics + MANIFEST
        └─ stream ZIP (sabit bellek)
  ──> (opsiyonel sandbox doğrulaması)
```

## 3. v2.0'da eklenenler

### Stream ZIP ve bellek

- `packages/packager/src/zip.ts`: `createZipStream` → `{ sizeBytes, stream() }`.
  JSZip `generateNodeStream` çıktısı Node `PassThrough`'a köprülenir; boyut sayan bir
  `Writable` ile arşiv belleğe alınmadan ölçülür.
- `build-package.ts` token metriğini dosya dosya hesaplar; tüm artifact'ları tek string'de
  birleştirmez.
- `packages/packager/tests/memory.test.ts`: 24 MB sıkıştırılamayan paket, `--expose-gc`
  ile ayrı süreçte profillenir; canlı heap yükün yarısının altında, tek chunk < 4 MB.

### 8 dilli i18n

- `packages/core/src/i18n/`: `en`, `tr`, `de`, `es`, `fr`, `pt`, `ja`, `zh`.
- `en` sözlüğü `MessageKey` üretir; diğerleri tam parity ile derlenir. Placeholder'lar
  korunur, eksik çeviri İngilizceye düşer.
- `/api/i18n`, `Accept-Language`, gövde `locale`, CLI `--locale`, doküman/ADR/görev
  paketleri ve manifest aynı kataloğu kullanır. Doğrulayıcılar dilden bağımsız yapısal
  kontroller yapar.

### Frontend (kod yok, sözleşme var)

- `web/index.html`, `web/app.js`, `web/styles.css` **kaldırıldı**; `packages/app/src/server.ts`
  yalnızca HTTP API sunar; statik dosya yokken `GET /` `200` + `application/json` ile
  `api-only` karşılama yanıtı verir (ad, sürüm, `FRONTEND_SPEC.md` referansı, `/api/*` uçları).
- Yerine kök dizinde `FRONTEND_SPEC.md`: 5 bölüm — ürün özeti/akışlar, 11 ekran ve
  bileşen/etkileşim listesi, tasarım sistemi (HEX token'lar, tipografi, dark/light,
  layout, responsive), tüm uçların istek/yanıt sözleşmesi, hata + yüklenme durumları.
- Arayüz yeni uç istemiyor; sözleşme mevcut backend ile birebir eşleşiyor. Frontend
  yazılacaksa aynı üç yol (`web/index.html`, `web/app.js`, `web/styles.css`) yeniden
  doldurulur, backend'e dokunulmaz.

### Tersine mühendislik (REA)

- `packages/reverse/src/index.ts`: `repoToState(root, options)`.
- Kaynaklar: kök/workspace `package.json`, `prisma/schema.prisma`, Compose dosyaları,
  ADR'ler ve UI bileşen dosyaları.
- Çıktı `sanitizeState` + `validateState`'ten geçer; bulgular/uyarılar raporlanır.
- CLI `--reverse`, API `POST /api/reverse`, MCP aracı ve arayüz `ReverseForm` aynı modülü
  kullanır.
- Entity'siz projelerde Prisma generator'ı generic `Item` modeline düşer.

### Multi-Sandbox Runner

- `packages/sandbox/src/index.ts`: `SandboxDriver` arayüzü + `detectSandboxes`,
  `resolveSandbox`, `runInSandbox`, `verifyPackage`.
- Sürücüler: `temp-dir`, `bwrap`, `podman`, `docker`, `firejail`, `systemd-run`.
- `auto` sırası: bwrap → podman → docker → firejail → systemd-run → temp-dir.
- Ortam allowlist'i (`PATH`, `LANG`, `HOME`, `TMPDIR`); API anahtarları geçmez.
  Kurulu olmayan sürücü için net hata, `fallback` ile güvenli `temp-dir` davranışı.
- CLI `--sandbox`, API `POST /api/sandbox` + `GET /api/sandboxes`, arayüz `SandboxPanel`.

### MCP sunucusu

- `packages/mcp/src/index.ts` + `tools.ts`; `@modelcontextprotocol/sdk` stdio taşıması.
- Araçlar: `architect_generate`, `architect_preview`, `architect_validate`,
  `architect_reverse_engineer`.
- `pnpm mcp`; istemci yapılandırmaları `docs/mcp.md`.

### Web araması

- `packages/app/src/web-search.ts`: `webSearch` + `formatSearchContext`.
- Sağlayıcılar: Tavily (`TAVILY_API_KEY`), Brave (`BRAVE_API_KEY`), anahtarsız DuckDuckGo.
- `runPipeline` içinde `ideaToState` öncesi çalışır; sonuç 4.000 karakterle sınırlanır.
- CLI `--web-search`, API `webSearch`, arayüz `SettingsDrawer` anahtarı.

## 4. v2.1'de eklenenler

### Mimar sohbeti (`packages/app/src/chat.ts`)

- `architectChat(state, message, options)` → `{ reply, state, changes, source, intent, notes }`.
- Deterministik ayrıştırıcı (TR + EN) niyetleri: `add-cache`, `add-database`, `add-queue`,
  `add-external`, `add-ui`, `add-field`, `remove-field`, `remove-component`,
  `split-services`, `describe`.
- Niyet ayrımı sıkılaştırıldı: alan ekleme yalnızca açık alan ifadesi, tip belirten
  identifier (`priorityCount int`) veya camelCase/snake_case identifier ile tetiklenir;
  "entity adı + ekle" cümlesi ve teknoloji adları (`cache`, `kafka`) alan sayılmaz.
- Mikroservis bölme yalnızca `mikroservis|microservices?` ya da servis kelimesi +
  `böl|split|ayır` ile çalışır; tek başına "böl" hiçbir şeyi değiştirmez.
- `Mikroservislere böl` her entity için bir servis üretir, `serviceId` atamalarını yeniler,
  veritabanı/kuyruk kenarlarını yeniden kurar ve ADR ekler.
- Her sonuç `sanitizeState` + `validateState` ile denetlenir; geçersiz bir değişiklik geri
  alınır ve not düşülür. `diffChanges` eklenen/silinen düğüm, kenar, entity ve alanları
  raporlar.
- BYOK modunda LLM `{reply, state}` döndürür; LLM hatası/geçersiz state durumunda
  deterministik sonuca düşülür (`notes` içinde nedeni yazılır).

### morluto/rea köprüsü (`packages/reverse/src/rea.ts`)

- `detectRea()` → `{ available, engine, binary, version, modes }`; `rea` / `rea-agents`
  PATH'te aranır, `ARCHITECT_REA_BIN` ile belirli bir kurulum gösterilebilir.
- Kuruluysa `rea analyze-javascript-application <path> --json` çalıştırılır; çıktı
  `--filter-output` ile ~54 KB'a indirilir (tam zarf ~34 MB), `normalized_result`
  dokümanı modül/asset/paket/endpoint/Electron bulgularına projekte edilir.
- Kurulu değilse yerleşik analizör: ELF/PE/Mach-O/WASM/SQLite imzaları, `.asar` başlığı,
  minified bundle imzaları, `.env.example` anahtar adları (değer okunmaz), Dockerfile,
  dış endpoint'ler. İki motor da aynı `evidence` şemasını üretir.
- `extractReaLimitations` REA'nın `limitations` alanını `rea.warnings`'a taşır;
  `mergeReaFindings` bulguları `ArchState`'e katar (veritabanı/kuyruk/dış servis düğümleri +
  `props.evidence`), `repoToStateWithRea` kaynak taraması ile birleştirir ve sonucu doğrular.
- Erişim: CLI `--use-rea`, `POST /api/reverse { useRea: true }`, MCP
  `architect_reverse_engineer { useRea: true }`, arayüz `ReverseForm` anahtarı.
- `rea-agents` launcher'ı Node `^22.23.4 || ^24.22.1 || >=26.12.1` ister; eski Node'da
  köprü sessizce değil, `rea.engine: "static"` + uyarı ile yerleşik analizöre düşer.

### Güvenlik, sözleşme ve kurulum sertleştirmesi (2026-11-24)

#### `/api/reverse` sınırları (`reverse-guard.ts`, `reverse-queue.ts`, `listen-host.ts`)

- `resolveReversePath`: `path.resolve` + `fs.realpath` ile `..` normalize edilir ve symlink
  çözülür; aday `REVERSE_ROOTS` köklerinden birinin altında değilse `ReversePathError`.
- Kök listesi boşsa eski davranış korunur, **ama** `HOST` loopback dışındaysa istek artık
  `403 reverse_disabled` ile reddedilir (yalnızca uyarı değil).
- `createReverseQueue`: FIFO, varsayılan `REVERSE_CONCURRENCY=2`; `REVERSE_QUEUE_TIMEOUT_MS`
  (30 sn) aşan bekleyen istek `429 reverse_busy`, `REVERSE_TIMEOUT_MS` (120 sn) aşan iş
  `504 reverse_timeout`; `rea` alt sürecine de aynı bütçe geçer.
- `HOST` varsayılanı `127.0.0.1`; Docker imajı `HOST=0.0.0.0` + `REVERSE_ROOTS=/workspace`
  ile gelir, yani konteyner ağdan erişilebilir ama yalnızca bağlanan çalışma alanını okur.
- Reddedilen yollarda çözümlenmiş yol istemciye döndürülmez.

#### HTTP sözleşmesi (`packages/app/src/contract.ts`)

- Uç başına zod şeması, ortak hata zarfı (`error`/`code`/`details`), `ENDPOINTS` ve
  `ERROR_CODES` listeleri; `/api/generate` için yanıt başlıkları (`x-validation`,
  `x-task-count`, `x-entities`, `x-tokenizer`, `x-locale`) da şemalı.
- `packages/app/tests/contract.test.ts`: her uç pozitif senaryoyla, 8 hata senaryosu `code`
  ile doğrulanır; state hem sözleşme şemasından hem `core.safeParseState`'ten geçer;
  `FRONTEND_SPEC.md` §4'teki uç listesi `ENDPOINTS` ile **iki yönlü** karşılaştırılır.
- Testler iki gerçek uyuşmazlık yakaladı ve spec düzeltildi: `locales` düz string değil
  `[{ id, label }]` nesneleridir; paket `wave` alanı sayı değil string grup kimliğidir
  (`"wave-0"`). Ayrıca `temp-dir` sürücüsünde `workspace` boş dönebilir.
- Yeni hata kodları: `path_not_allowed` (400), `reverse_busy` (429), `reverse_timeout`
  (504), `reverse_disabled` (403) — hepsi `FRONTEND_SPEC.md` §5 tablosunda.

#### `architect init` (`packages/app/src/init.ts`)

- `pnpm architect init [dir] [--client cursor|claude|opencode|freebuff|all] [--force]`.
- Yazar: `.architect/config.json` (client, MCP komutu, `reverseRoots` = hedef dizin,
  paket/test çalıştırıcı), `.cursor/mcp.json`, `.mcp.json`, `opencode.json` ve `AGENTS.md`
  içindeki `<!-- architect:start --> … <!-- architect:end -->` bloğu.
- İdempotent: ikinci koşu hiçbir dosyayı yazmaz; `AGENTS.md`'de yalnızca kendi bloğunu
  günceller, sahibi olmadığı dosyalara `--force` olmadan dokunmaz. Freebuff için dosya
  yazmaz, MCP ekranından ekleme notu düşer.

#### Araç zinciri hizalaması

- `.nvmrc` = `24.22.1`, `engines.node` = `^22.23.4 || ^24.22.1 || >=26.12.1`, CI
  `node-version-file: .nvmrc`, Docker `node:24-alpine`, `@types/node` `^24` (lockfile
  `24.19.4`). `rea` launcher'ı bu aralığın dışında sessizce `static` motora düşer.
- `.env.example` içinde `HOST` yorumda tutulur (Docker `--env-file` loopback'e bağlamasın).

#### Artımlı reverse + SSE iş akışı

- `packages/reverse/src/cache.ts`: `fingerprintKey` envanteri (yol, boyut, mtime), analizörün
  okuduğu dosyaların SHA-256 içeriğini (manifest, Prisma, Compose, ADR, `.env.example`,
  Dockerfile; ≤64 KB) ve seçenekleri hash'ler. `readCache`/`writeCache` atomik yazar
  (tmp + rename), 24 saat TTL uygular; `ARCHITECT_CACHE_DIR` yolu, `REVERSE_CACHE=0` kapatır.
- `repoToStateCached` (`packages/reverse/src/index.ts`): isabet varsa parse/merge/validate ve
  `rea` alt süreci atlanır; `cacheHit` alanı döner. `POST /api/reverse { cache: false }` atlar.
- `packages/app/src/jobs.ts`: süreç içi iş deposu (5 dk TTL, 50 iş, abonelik tabanlı akış).
- `POST /api/reverse/jobs` → `202 { jobId, status, events }`; `GET /api/reverse/jobs/:id`
  durum + olay geçmişi; `GET /api/reverse/jobs/:id/events` `text/event-stream` ile
  `scan → rea → merge → validate → done|error` akıtır. `seq` artımlıdır; biten işe sonradan
  bağlanan istemci tüm geçmişi alır ve akış kapanır. Aynı yol allowlist'i ve kuyruk geçerli.
- Doğrulama: 233 → 241 test; doctor `--write` ve deterministik ZIP testleri eklendi.
- Ölçüm (bu makine): 391 dosyalık fixture **104,9 ms → 16,3 ms (6,4x)**; depo 60,3 → 9,5 ms
  (6,3x); manifest düzenlenince `cacheHit: false`. Anahtar artık çözümlenmiş kök dizini de
  içerir: aynı içerikli iki ayrı checkout ayrı girdi üretir (testle doğrulandı).

#### `architect doctor`

- `packages/app/src/doctor.ts`: `doctorProject` kaydedilmiş state ile `repoToState(root)`
  sonucunu karşılaştırır; `compareStates` node/edge/entity/field/decision bazında
  `added|removed|updated` üretir. `validateState` hataları da rapora girer.
- CLI: `pnpm architect doctor [dir] [--state <path>] [--json] [--fail-on-drift]`;
  çıkış **0** temiz, **1** `--fail-on-drift` + kayma, **2** state yok/bozuk.
- `--write` state dosyasını üretir (yoksa oluşturur, varsa tazeler); bozuk/şema dışı dosya
  da `--write` ile yeniden yazılır (çıkış 0), `--write` yoksa çıkış 2 kalır; ipucu artık
  `doctor --write`'a yönlendirir.
- Sınır: üretilmiş `openapi.yaml`/`ARCHITECTURE.md` geri ayrıştırılmaz, kayma yapısaldır.

#### CI düzeltmeleri (2026-11-26)

- `verify` işi: `rea.test.ts` içindeki "derives a valid state…" testi, PATH'te bulunan
  gerçek `rea` CLI'sını (devDependency `rea-agents` → `node_modules/.bin/rea`) seçtiği için
  `static` beklerken `rea` alıyordu. Test `rea: { staticOnly: true }` ile sabitlendi; CI
  benzeri PATH (çalışan sahte `rea`) ile doğrulandı.
- `docker` işi: Dockerfile kaldırılmış `web/` dizinini kopyalıyordu (`"/web": not found`).
  `COPY web ./web` kaldırıldı; tüm COPY kaynaklarının varlığı betikle kontrol edildi.

#### Deterministik ZIP (Plan §6)

- `zip.ts`: girdi zaman damgası `1980-01-01T00:00:00Z`, `unixPermissions: 0o644`, adlara göre
  sabit sıralama, `platform: "UNIX"`; `store`/`deflate` profilleri seçilebilir.
- `ZipStream.sha256`: ölçüm geçişinde arşiv baytlarından hesaplanır (ekstra tampon yok).
- `/api/generate` → `X-Package-SHA256`; CLI → `Package SHA-256:` satırı; `--reproducible`
  veya `REPRODUCIBLE=1` `state_to_package_ms` metriğini sıfırlar.
- Doğrulama: aynı fixture iki ayrı süreçte `6d6870…7cb1` hash'ini verdi; testler byte eşitliği,
  giriş tarih/modları ve iki sıkıştırma profilini kapsıyor.

#### Kalite kapısı ve CPU/RAM optimizasyonu (2026-11-24)

- Optimizasyon öncesi kapı (hepsi geçti): tam test paketi, `typecheck` (9 proje), JSON
  yapılandırmaların ayrıştırılması, sır taraması (izlenen dosyalar), `only/skip` kalıntısı
  yokluğu, Nx proje sayısı (9), README/PROJECT-SUMMARY test sayıları.
- Optimizasyonlar: `repoToStateCached` artık dizini **bir kez** yürür (`inventory` seçeneği
  ile sonuç `repoToState`'e geçer), `scan` tek `statSync` çağrısından `size` + `mtimeMs`
  üretir, içerik özetleri (path,size,mtime) ile 4096 girişlik memo'da tutulur, son 4 sonuç
  süreç içi memo'da saklanır (JSON parse atlanır) ve `skipped` listesi 200 girdiyle sınırlıdır.
- Sonuç (391 dosyalık fixture): soğuk **110,5 → 52,9 ms**, sıcak **18,7 → 5,8 ms**, sıcak
  yolda dosya okuması **12 → 0**, heap **10–14 MB → 11–13 MB**.

## 5. Nx monorepo

- `nx.json`: `defaultBase: main`, `useDaemonProcess: false`, `namedInputs`
  (`default`/`production`/`sharedGlobals`) ve `test`/`typecheck` için `cache: true`.
- `tsconfig.base.json` ortak derleyici ayarları + `@architect-studio/workspace-plugin`
  path eşlemesi; kök `tsconfig.json` yalnızca `packages/**` ve `vitest.config.ts` içerir.
- Paketler arası import'lar göreli (`../../core/src/state`) olduğu için kenarlar her
  `project.json` içindeki `implicitDependencies` ile bildirilir: app → core, generators,
  packager, reverse, sandbox, validators; packager → core, generators, validators;
  mcp → app, core, generators, packager, reverse, validators; generators/reverse → core.
- 9 proje: `core`, `generators`, `validators`, `packager`, `app`, `reverse`, `sandbox`,
  `mcp`, `nx-plugin`. Her biri kendi `project.json` (`typecheck`, çoğunda `test`) ve
  `tsconfig.json` dosyasına sahip; hedefler `nx:run-commands` ile `tsc`/`vitest` çağırır.
- Kök script'ler Nx'e bağlı: `dev`/`start` → `nx run app:*`, `test`/`typecheck` →
  `nx run-many`, `build` → `run-many -t typecheck test`, `affected` → `nx affected`.
- `pnpm-workspace.yaml`: `packages/*` + `allowBuilds` (`esbuild`, `nx`, `frida: false`).
- `.nx/` git'e girmez (önbellek).
- Mimari harita: `pnpm nx graph --host 127.0.0.1 --port 4211` canlı proje grafiği,
  `pnpm nx graph --file=graph.html` statik çıktı.

### Yerel Nx generator'ı (`packages/nx-plugin`)

- `@architect-studio/workspace-plugin`: `package.json`, `generators.json`,
  `project.json` (`nx-plugin`), `src/index.ts`, `src/generators/package/{generator.ts,schema.json}`.
- `package` generator'ı depo kurallarıyla yeni kütüphane üretir:
  `packages/<ad>/project.json` (typecheck + test hedefleri), `tsconfig.json`,
  `src/index.ts`, `tests/<ad>.test.ts`. Kebab-case dışı ad ve var olan dizin reddedilir.
- Kullanım: `pnpm nx g @architect-studio/workspace-plugin:package order-flow --dry-run`
  (Nx 24 yol tabanlı generator çağrısını desteklemediği için plugin + tsconfig path
  eşlemesi kullanılıyor).

## 6. Dosya yapısı

```text
architect-studio/
├─ package.json                 # Nx script'leri, bağımlılıklar
├─ nx.json / tsconfig.base.json / tsconfig.json / vitest.config.ts
├─ Dockerfile / .env.example / LICENSE
├─ .github/workflows/ci.yml
├─ examples/architecture.json
├─ README.md / PROJECT-SUMMARY.md / FRONTEND_SPEC.md
├─ docs/mcp.md
└─ packages/
   ├─ core/        # state, diff, i18n, tokenizer, metrics, task-packet
   ├─ generators/  # openapi, prisma, asyncapi, mermaid, docs
   ├─ validators/  # deterministik doğrulama + self-heal
   ├─ packager/    # stream ZIP, metrics, manifest, OpenCode agents
   ├─ app/         # demo/LLM, chat, web-search, pipeline, server, CLI, init, contract
   ├─ reverse/     # repoToState + rea.ts (morluto/rea köprüsü)
   ├─ sandbox/     # çoklu sandbox sürücüleri
   ├─ mcp/         # MCP araçları + stdio sunucusu
   └─ nx-plugin/   # yerel Nx plugin + package generator'ı
```

## 7. Doğrulanmış sonuçlar

| Kontrol | Sonuç |
|---|---|
| `pnpm test` | 8 proje, 25 dosya, 244/244 test geçti |
| Deterministik ZIP | 5 test: iki koşu aynı hash/bayt, sabit tarih+mod, store/deflate, `REPRODUCIBLE=1` |
| `doctor --write` | 5 test: state oluşturma, tazeleme, bozuk JSON/şema onarımı, özel `--state` yolu |
| `architect doctor` | 15 test: temiz repo, eklenen düğüm/alan, silinen entity/alan, bozuk state, çıkış 0/1/2, `--json` |
| CPU/RAM optimizasyonu | cold 110,5 → 52,9 ms, warm 18,7 → 5,8 ms, sıcak yolda okuma 12 → 0, heap düz |
| Reverse yol güvenliği | allowlist + realpath (symlink/`..` reddedilir); loopback dışı HOST + boş `REVERSE_ROOTS` → `403 reverse_disabled`; kuyruk 2 eşzamanlı, `reverse_busy`/`reverse_timeout` testli |
| Sözleşme testleri | 17 test: 10 ucun şeması, 8 hata kodu, ZIP başlıkları, `FRONTEND_SPEC.md` ↔ `ENDPOINTS` iki yönlü |
| `architect init` | 13 test: config + 3 istemci dosyası + AGENTS.md bloğu; ikinci koşu hiçbir şey yazmıyor |
| Artımlı reverse | 391 dosyalık fixture cold 104,9 ms → warm medyan 16,3 ms (**6,4x**); depo 60,3 → 9,5 ms (6,3x); manifest düzenlenince `cacheHit: false` |
| SSE iş akışı | `POST /api/reverse/jobs` → `scan/rea/merge/validate/done`; `GET .../events` `text/event-stream`; geç bağlanma geçmişi alır |
| Docker imajı | `node:24-alpine`, `HOST=0.0.0.0`, `REVERSE_ROOTS=/workspace` — imaj build edilmedi, yalnızca dosya düzeyinde değişti |
| `pnpm typecheck` | 9 proje temiz |
| `pnpm install` | temiz (allowBuilds ile ignored-build uyarısı yok) |
| Stream ZIP bellek profili | 24 MB paket, canlı heap < yükün ½'si, chunk < 4 MB |
| 54 düğümlü mimari | süre bütçesi içinde, 20 eşzamanlı önizleme, fuzz/E2E indirme |
| CLI sandbox | `temp-dir` ve bu makinede `auto → bwrap`, çıkış 0 |
| CLI reverse | mevcut repo analizi → geçerli `ArchState` + paket |
| API reverse (HTTP) | `POST /api/reverse { useRea: true }` gerçek fixture'da `200`, `rea.engine: "rea"`, 4 REA bulgusu, 1 artifact |
| 8 dil | katalog parity + yerelleştirilmiş doküman/manifest doğrulaması |
| API | preview/generate/reverse/sandbox/sandboxes/chat/rea uçları testli; `GET /` `200` `api-only` karşılama JSON'u döner |
| MCP | dört araç, ZIP yazımı, hata içerikleri ve `useRea` testli |
| Sohbet | TR/EN niyetler, tip çıkarımı, mikroservis bölme, LLM fallback ve `/api/chat` testli |
| REA köprüsü | sahte `rea` CLI'ı, `normalized_result` zarfı, Evidence projeksiyonu, ASAR/ELF/env/Dockerfile analizi testli |
| Nx generator | `--dry-run` + gerçek üretim; üretilen paket `tsc` temiz, Vitest 1/1 geçti |

Test dağılımı: core 32 (4 dosya), generators 10, validators 10, packager 16 (3 dosya),
app 135 (11 dosya: app, server, chat, web-search, stress, contract, reverse-guard,
reverse-queue, reverse-jobs, init, doctor), reverse 24 (3 dosya: index, rea, cache), sandbox
11, mcp 6.

## 8. Kalan sınırlar (bilinçli)

- Kimlik doğrulama, kullanıcı/oturum, kalıcılık yok; sunucu tek süreç ve in-memory.
- Rate limit süreç başına; çok örnekli dağıtımda paylaşılmaz.
- **Studio arayüzü kod olarak yok:** `FRONTEND_SPEC.md` sözleşme; `GET /` arayüz dosyası
  yokken `200` `api-only` karşılama JSON'u döner, tüm `/api/*` uçları çalışır.
- Görev metinleri şablon; LLM yalnızca state üretir. Kabul kriterleri hedef repoda
  çalıştırılmaz.
- Sandbox `podman`/`docker` sürücüleri imajın önceden çekilmiş olmasını bekler; Docker
  soketi konteyner içinde ayrıca verilmelidir.
- Tarayıcı E2E (Playwright) yok; indirme akışı HTTP seviyesinde test edilir.
- Web araması anahtarsız modda DuckDuckGo instant-answer kalitesine bağlıdır.
- Tam OpenAPI/AsyncAPI meta-şema doğrulaması yerine yapısal kontroller kullanılır.
- `rea` köprüsü Node `^22.23.4 || ^24.22.1 || >=26.12.1` ister; aksi halde yerleşik
  analizör kullanılır.
- `/api/reverse` kimlik doğrulaması istemez: loopback dışına açıldığında `REVERSE_ROOTS`
  zorunludur, yoksa uç `403 reverse_disabled` döner. Kuyruk ve süre bütçeleri süreç içidir,
  çok örnekli dağıtımda paylaşılmaz.
- Sözleşmenin kaynağı `packages/app/src/contract.ts` şemalarıdır; uç listesi testle
  `FRONTEND_SPEC.md` §4 ile karşılaştırılır. Spec'i güncellemeden uç eklemek/kaldırmak
  `pnpm test`'i kırar.

## 9. Yeni geliştirici için ilk adımlar

1. `pnpm test && pnpm typecheck` (Nx önbelleği ile hızlı).
2. `pnpm nx graph` ile 9 projenin bağımlılık haritasını gör.
3. `pnpm dev`; `curl -s localhost:3000/api/health` ve `POST /api/preview` ile API'yi dene.
4. `FRONTEND_SPEC.md`'ye göre `web/index.html|app.js|styles.css` yaz (backend'e dokunmadan).
5. `pnpm nx g @architect-studio/workspace-plugin:package <ad> --dry-run` ile yeni paket
   iskeletini gör.
6. `pnpm generate -- --reverse . --use-rea --sandbox auto` ile REA + sandbox akışını gör.
7. `pnpm mcp` ve `docs/mcp.md` ile bir MCP istemcisine bağlan.
8. Sonraki iyileştirme adayları:
   - Playwright ile gerçek indirme/dil E2E testi.
   - Tam OpenAPI/AsyncAPI meta-şema doğrulaması (ajv + spec şemaları).
   - Sandbox içinde `install + test` çalıştıran paket doğrulama profilleri.
   - REA'da OpenAPI/SQL kaynaklarından ek entity çıkarımı.
   - `nx-plugin` için `create-package` dışında `generator`/`executor` şablonları.

## 10. Faydalı komutlar

```bash
pnpm dev                                  # nx run app:dev (API, :3000)
pnpm test / pnpm typecheck / pnpm build
pnpm affected                             # nx affected -t typecheck test
pnpm nx graph --host 127.0.0.1 --port 4211
pnpm nx show projects
pnpm nx run app:dev
pnpm nx g @architect-studio/workspace-plugin:package <ad> --dry-run
pnpm mcp
pnpm architect init . --client all         # yapılandırma + MCP dosyaları + AGENTS.md bloğu
pnpm architect doctor . --fail-on-drift    # kaydedilmiş mimari ile depo arasındaki kayma (CI)
pnpm architect doctor . --write             # state dosyasını üret/tazele

# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Tersine mühendislik + sandbox
pnpm generate -- --reverse ../my-project --use-rea --sandbox auto --out out/reverse.zip

# Türkçe + web araması
pnpm generate -- --idea "..." --demo --locale tr --web-search

# Mevcut state'ten paket + dizine açma
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Docker
docker build -t architect-studio .
docker run --rm -p 3000:3000 -v "$PWD:/workspace" architect-studio
```
