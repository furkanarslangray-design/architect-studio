# PROJECT-SUMMARY — AI Principal Architect (v2.0.0)

Yeni geliştirici devir teslim notu. Son güncelleme: 2026-11-22.

## 1. Proje nerede?

**Klasör:** `/home/furkanarslangray/architect-studio` (bu çalışma kopyasında worktree)
**Branch:** `mvp` / `main` (worktree dalı `freebuff/dosya-devralma-ve-kodlamaya-devam`)
**Durum:** v2.0.0 — tüm modüller tamamlandı, test/typecheck/build yeşil.

```bash
pnpm install
pnpm dev              # http://localhost:3000
pnpm mcp              # stdio MCP sunucusu
```

Gereksinim: Node >= 22, pnpm. Bağımlılıklar: `gpt-tokenizer`, `jszip`, `yaml`, `zod`,
`@modelcontextprotocol/sdk`, `mermaid`.

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
- Web UI, `/api/i18n`, `Accept-Language`, gövde `locale`, CLI `--locale`, doküman/ADR/görev
  paketleri ve manifest aynı kataloğu kullanır. Doğrulayıcılar dilden bağımsız yapısal
  kontroller yapar.

### Frontend Studio

- `web/index.html`, `web/app.js`, `web/styles.css`: 8 dilli seçici, canlı Mermaid
  (`/vendor/mermaid.min.js`), dosya ağacı + içerik görüntüleme, görev/metrik/doğrulama
  sekmeleri, state düzenleme, ZIP indirme.
- Proje analizi paneli (`POST /api/reverse`), sandbox seçici + doğrulama
  (`POST /api/sandbox`) ve canlı web araması anahtarı.

### Tersine mühendislik (REA)

- `packages/reverse/src/index.ts`: `repoToState(root, options)`.
- Kaynaklar: kök/workspace `package.json`, `prisma/schema.prisma`, Compose dosyaları,
  ADR'ler ve UI bileşen dosyaları.
- Çıktı `sanitizeState` + `validateState`'ten geçer; bulgular/uyarılar raporlanır.
- CLI `--reverse`, API `POST /api/reverse`, Studio paneli ve MCP aracı aynı modülü kullanır.
- Entity'siz projelerde Prisma generator'ı generic `Item` modeline düşer.

### Multi-Sandbox Runner

- `packages/sandbox/src/index.ts`: `SandboxDriver` arayüzü + `detectSandboxes`,
  `resolveSandbox`, `runInSandbox`, `verifyPackage`.
- Sürücüler: `temp-dir`, `bwrap`, `podman`, `docker`, `firejail`, `systemd-run`.
- `auto` sırası: bwrap → podman → docker → firejail → systemd-run → temp-dir.
- Ortam allowlist'i (`PATH`, `LANG`, `HOME`, `TMPDIR`); API anahtarları geçmez.
  Kurulu olmayan sürücü için net hata, `fallback` ile güvenli `temp-dir` davranışı.
- CLI `--sandbox`, API `POST /api/sandbox` + `GET /api/sandboxes`, Studio seçici.

### MCP sunucusu

- `packages/mcp/src/index.ts` + `tools.ts`; `@modelcontextprotocol/sdk` stdio taşıması.
- Araçlar: `architect_generate`, `architect_preview`, `architect_validate`,
  `architect_reverse_engineer`.
- `pnpm mcp`; istemci yapılandırmaları `docs/mcp.md`.

### Web araması

- `packages/app/src/web-search.ts`: `webSearch` + `formatSearchContext`.
- Sağlayıcılar: Tavily (`TAVILY_API_KEY`), Brave (`BRAVE_API_KEY`), anahtarsız DuckDuckGo.
- `runPipeline` içinde `ideaToState` öncesi çalışır; sonuç 4.000 karakterle sınırlanır.
- CLI `--web-search`, API `webSearch`, Studio anahtarı.

## 4. Dosya yapısı

```text
architect-studio/
├─ package.json                 # v2.0.0, dev/test/build/generate/mcp script'leri
├─ tsconfig.json / vitest.config.ts
├─ Dockerfile / .env.example / LICENSE
├─ .github/workflows/ci.yml
├─ examples/architecture.json
├─ README.md / PROJECT-SUMMARY.md
├─ docs/mcp.md
├─ web/{index.html,app.js,styles.css}
└─ packages/
   ├─ core/        # state, diff, i18n, tokenizer, metrics, task-packet
   ├─ generators/  # openapi, prisma, asyncapi, mermaid, docs
   ├─ validators/  # deterministik doğrulama + self-heal
   ├─ packager/    # stream ZIP, metrics, manifest, OpenCode agents
   ├─ app/         # demo/LLM, web-search, pipeline, server, CLI
   ├─ reverse/     # repoToState (REA)
   ├─ sandbox/     # çoklu sandbox sürücüleri
   └─ mcp/         # MCP araçları + stdio sunucusu
```

## 5. Doğrulanmış sonuçlar

| Kontrol | Sonuç |
|---|---|
| `pnpm test` | 15 dosya, 128/128 test geçti |
| `pnpm typecheck` | temiz |
| `pnpm build` | typecheck + 128 test geçti |
| Stream ZIP bellek profili | 24 MB paket, canlı heap < yükün ½'si, chunk < 4 MB |
| 54 düğümlü mimari | süre bütçesi içinde, 20 eşzamanlı önizleme, fuzz/E2E indirme |
| CLI sandbox | `temp-dir` ve bu makinede `auto → bwrap`, çıkış 0 |
| CLI reverse | mevcut repo analizi → geçerli `ArchState` + paket |
| 8 dil | katalog parity + yerelleştirilmiş doküman/manifest doğrulaması |
| API | preview/generate/reverse/sandbox/sandboxes uçları testli |
| MCP | dört araç, ZIP yazımı ve hata içerikleri testli |

Test dağılımı: core 32 (state/diff/task-packet/i18n), generators 10, validators 10,
packager 11 (9 + 2 bellek), app 43 (app 10, server 20, web-search 7, stress 6),
reverse 5, sandbox 11, mcp 6.

## 6. Kalan sınırlar (bilinçli)

- Kimlik doğrulama, kullanıcı/oturum, kalıcılık yok; sunucu tek süreç ve in-memory.
- Rate limit süreç başına; çok örnekli dağıtımda paylaşılmaz.
- Görev metinleri şablon; LLM yalnızca state üretir. Kabul kriterleri hedef repoda
  çalıştırılmaz.
- Sandbox `podman`/`docker` sürücüleri imajın önceden çekilmiş olmasını bekler; Docker
  soketi konteyner içinde ayrıca verilmelidir.
- Tarayıcı E2E (Playwright) yok; indirme akışı HTTP seviyesinde test edilir.
- Web araması anahtarsız modda DuckDuckGo instant-answer kalitesine bağlıdır.
- Tam OpenAPI/AsyncAPI meta-şema doğrulaması yerine yapısal kontroller kullanılır.

## 7. Yeni geliştirici için ilk adımlar

1. `pnpm test && pnpm typecheck`.
2. `pnpm dev`; Studio'da demo moduyla önizle, dil değiştir, ZIP indir.
3. `pnpm generate -- --reverse . --sandbox auto` ile REA + sandbox akışını gör.
4. `pnpm mcp` ve `docs/mcp.md` ile bir MCP istemcisine bağlan.
5. Sonraki iyileştirme adayları:
   - Playwright ile gerçek indirme/dil E2E testi.
   - Tam OpenAPI/AsyncAPI meta-şema doğrulaması (ajv + spec şemaları).
   - Sandbox içinde `install + test` çalıştıran paket doğrulama profilleri.
   - REA'da OpenAPI/SQL kaynaklarından ek entity çıkarımı.

## 8. Faydalı komutlar

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm build
pnpm mcp

# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Tersine mühendislik + sandbox
pnpm generate -- --reverse ../my-project --sandbox auto --out out/reverse.zip

# Türkçe + web araması
pnpm generate -- --idea "..." --demo --locale tr --web-search

# Mevcut state'ten paket + dizine açma
pnpm generate -- --json examples/architecture.json --out out/package.zip --extract out/package

# Docker
docker build -t architect-studio .
docker run --rm -p 3000:3000 --env-file .env.example architect-studio
```
