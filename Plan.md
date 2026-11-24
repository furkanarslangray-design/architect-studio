# Plan — sonraki adımlar (implementasyon planı)

**Durum:** hiçbir madde başlatılmadı. Bu dosya yalnızca plan ve uygulama notlarıdır.
**Tarih:** 2026-11-24 · **Sürüm:** v2.1.0 üzerine
**Kapsam:** 12 madde, değere göre sıralı; her maddede amaç, tasarım, dokunulacak dosyalar,
adımlar, testler, kabul kriteri, risk ve efor var.

## 0. Ortak kabuller

- **Spec önce:** yeni/değişen her uç ve yanıt alanı `FRONTEND_SPEC.md` §4'e, hata durumları
  §5'e yazılmadan kod yazılmaz.
- **Nx disiplini:** iş, ilgili `packages/<proje>` içinde yapılır; `project.json` hedefleri
  korunur. Bitirmeden `pnpm typecheck` (9 proje) ve `pnpm test` (8 proje) yeşil olmalı.
- **Geri uyum:** mevcut uçlar (`/api/preview|chat|generate|reverse|sandbox`, `GET /api/*`)
  alan silmeden genişletilir; davranış değişikliği varsa `PROJECT-SUMMARY.md` §8'e yazılır.
- **Güvenlik:** sırlar (API anahtarı, GitHub token) koda, loga, test fixture'ına yazılmaz;
  ortam değişkeni veya `gh` oturumu üzerinden kullanılır.
- **Yeni bağımlılık** eklenirse `pnpm-workspace.yaml` `allowBuilds` ve lockfile aynı commit'te.
- **Teslim biçimi:** her madde kendi commit'i + PR'ı; PR açıklamasında "neden" ve ölçüm.

Efor birimleri: **S** ≤ 1 gün, **M** 2–3 gün, **L** 4+ gün (tek geliştirici varsayımı).

---

## 1. Spec uyum testleri (`FRONTEND_SPEC.md` ↔ backend) — S/M

**Amaç:** Spec'i "doküman"dan yürütülebilir kontrata çevirmek. Arayüz yazılmadan önce
sözleşmeyi dondurmak.

**Tasarım**

- `packages/app/tests/contract.test.ts`: her uç için bir senaryo; yanıt gövdesi şemayla
  doğrulanır (alan adı, tip, zorunluluk, enum'lar).
- Şema tek kaynaktan gelsin: `packages/app/src/contract.ts` içinde uç başına zod şeması
  (zod zaten bağımlılık). Testler bu şemaları kullanır; hata kodları için
  `{ error, code, details? }` şeması ve kod listesi (`invalid_path`, `invalid_json`,
  `payload_too_large`, `rate_limited`, `invalid_sandbox`, `internal_error`, `llm_failed`).
- Tip üretimi: şemalardan `tsc` ile okunabilir tipler; arayüz yazılırken `web/app.js`
  yanında `web/types.d.ts` bu şemalardan üretilir (ele yazılmaz).
- Spec ↔ kod farkı için hafif kontrol: `FRONTEND_SPEC.md` §4'teki uç/alan adları
  ayrıştırılıp şema anahtarlarıyla karşılaştırılır; fark varsa test kırılır.

**Dokunulacak dosyalar**

- `packages/app/src/contract.ts` (yeni), `packages/app/tests/contract.test.ts` (yeni)
- `packages/app/src/server.ts` (yalnızca `sendJson` çağrılarını şema ile doğrulama opsiyonu)
- `FRONTEND_SPEC.md` §4 (eksik alanlar tamamlanır)

**Adımlar**

1. Mevcut yanıtları uç uç dolaşıp alan envanteri çıkar (health, version, i18n, sandboxes,
   rea, preview, chat, generate başlıkları, reverse, sandbox).
2. Her uç için zod şeması + ortak hata şeması.
3. Test: 200 yanıtı şemaya uyuyor mu; 400/413/429 için `code` alanı doğru mu.
4. `generate` için gövde yerine başlıklar (`X-Validation`, `X-Task-Count`, `Content-Type`,
   `Content-Length`) sözleşmeye bağlanır.
5. CI'da `pnpm test` içinde otomatik çalışır; ayrı hedef gerekmez.

**Kabul kriteri:** Spec'teki her uç için en az bir pozitif + bir hata senaryosu test edilir;
bir alan yeniden adlandırıldığında test kırmızıya döner.

**Risk:** Aşırı katı şema, meşru alan eklemelerini bloklar → `passthrough()` kullan,
yalnızca belgelenen alanları zorunlu tut.

**Bağımlılık:** yok. **Sıralamada ilk** çünkü 2, 4, 9 ve arayüz işini derisksize eder.

---

## 2. `/api/reverse` güvenlik ve eşzamanlılık sınırı — S

**Amaç:** Kimlik doğrulaması olmayan bir ucun keyfî yerel dizin okumasını ve `rea` alt
süreç çoğalmasını engellemek.

**Tasarım**

- Varsayılan bağlanma adresi `127.0.0.1`; `HOST` ile açıkça değiştirilebilir, ağa açılınca
  log'a uyarı yazılır.
- `REVERSE_ROOTS` (iki nokta ile ayrılmış dizin listesi). Tanımlıysa yalnızca bu köklerin
  altındaki yollar kabul edilir; `path.resolve` + `fs.realpath` ile symlink kaçışı kontrol
  edilir, `..` normalizasyonu sonrası karşılaştırma yapılır.
- Tanımsızsa davranış bugünküyle aynı kalır (geri uyum), ama `HOST` loopback dışıysa ve
  `REVERSE_ROOTS` yoksa sunucu açılışta uyarır; `--strict-reverse` ile zorunlu kılınabilir.
- Eşzamanlılık: `REVERSE_CONCURRENCY` (varsayılan 2) — basit FIFO kuyruk; aşan istekler
  bekletilir, `REVERSE_QUEUE_TIMEOUT_MS` (varsayılan 30 000) aşılırsa `429` +
  `code: "reverse_busy"`.
- İstek başına süre bütçesi: `REVERSE_TIMEOUT_MS` (varsayılan 120 000) → `504` `reverse_timeout`.
- Hata kodları `FRONTEND_SPEC.md` §5 tablosuna eklenir.

**Dokunulacak dosyalar**

- `packages/app/src/server.ts` (`startServer`, yeni `resolveReversePath`, kuyruk)
- `packages/app/src/reverse-queue.ts` (yeni, birim testli)
- `packages/app/tests/server.test.ts` (allowlist, symlink, `..`, kuyruk, timeout)
- `.env.example` (yeni değişkenler), `README.md` (güvenlik bölümü)

**Adımlar**

1. `resolveReversePath(input, roots)` saf fonksiyonu + birim testleri (symlink, `..`,
   göreli yol, kök dışı).
2. Sunucuda `HOST` varsayılanı ve uyarı.
3. Kuyruk + zaman aşımı; `rea` alt süreci `AbortSignal` ile iptal edilir
   (`child_process.spawn` + `signal`).
4. Spec/README güncellemesi.

**Kabul kriteri:** `REVERSE_ROOTS=/tmp/rea-small` iken `/etc` yolu `400 invalid_path`
döner ve dosya adı sızdırmaz; 5 eşzamanlı istekten fazlası kuyruğa girer, süreç sayısı 2'yi
aşmaz.

**Risk:** `realpath` sembolik bağları çözerken kullanıcı beklentisini değiştirebilir →
hata mesajında çözümlenmiş yolu gösterme.

**Bağımlılık:** yok; 3 ve arayüzden önce yapılmalı.

---

## 3. `architect init` — hedef repoya tek komutla kurulum — S/M

**Amaç:** Paketin ilk kullanım anını 5 dakikadan 10 saniyeye indirmek.

**Tasarım**

- CLI alt komutu: `pnpm architect init [dir] [--client cursor|claude|opencode|freebuff|all]`
  (mevcut CLI argüman ayrıştırıcısı `packages/app/src/cli.ts` alt komut desteğiyle
  genişletilir; varsayılan davranış `--idea`/`--reverse` olarak korunur).
- Yazılanlar (hepsi **varsa atlanır**, `--force` ile üzerine yazılır):
  - `.architect/config.json`: `{ client, reverseRoots, packageManager, testRunner }`
  - istemci yapılandırması: `.cursor/mcp.json`, `.mcp.json`, `opencode.json`
    (mevcut `docs/mcp.md` örneklerinden üretilir)
  - `.architect/state.json`: `repoToState(dir)` çıktısı (opsiyonel, `--scan` ile)
  - `AGENTS.md` sonuna işaretli blok: `<!-- architect:start --> … <!-- architect:end -->`
    (tekrar çalıştırmada yalnızca bu blok güncellenir)
- Komut sonunda özet: yazılan/atlanan dosyalar + sonraki adım (`POST /api/preview`).

**Dokunulacak dosyalar**

- `packages/app/src/init.ts` (yeni), `packages/app/src/cli.ts` (alt komut)
- `packages/app/tests/init.test.ts` (yeni; geçici dizinde gerçek dosya yazımı)
- `docs/mcp.md`, `README.md` (hızlı başlangıç 3 satıra iner)

**Kabul kriteri:** Boş bir dizinde `init --client all` üç yapılandırmayı yazar, ikinci
çalıştırma hiçbir dosyayı değiştirmez (idempotent), `AGENTS.md` bloğu tekrar eklenmez.

**Risk:** Kullanıcı dosyalarını ezmek → yalnızca kendi ürettiği işaretli blok ve
`--force` ile yazma.

---

## 4. Artımlı reverse + ilerleme akışı (SSE) — M

**Amaç:** Ölçülen 26,7 sn'lik reverse süresini değişmeyen repoda < 1 sn'ye indirmek ve uzun
işlemlerde istemci zaman aşımını kaldırmak.

**Tasarım**

- Önbellek: içerik hash'i (SHA-256, dosya başına) + `rea` sürümü + seçenekler → sonuç.
  Yer: `.architect/cache/reverse/<hash>.json` (proje içinde, gitignore'a eklenir) veya
  `ARCHITECT_CACHE_DIR`. TTL yok; hash değişince otomatik geçersiz.
- `POST /api/reverse` gövdesine `cache: false` seçeneği (varsayılan açık).
- İlerleme: iş kimliği döndüren `POST /api/reverse/jobs` (`202 { jobId }`) +
  `GET /api/reverse/jobs/:id/events` (SSE: `scan`, `rea`, `merge`, `validate`, `done`,
  `error`). Mevcut senkron uç **korunur** (geri uyum); spec'e yeni akış eklenir.
- REA adımı `spawn` çıktısını satır satır aktarır (`--json` olduğu için yalnızca aşama
  bildirimi yapılır, ham JSON istemciye gitmez).

**Dokunulacak dosyalar**

- `packages/reverse/src/cache.ts` (yeni), `packages/reverse/src/index.ts` (cache kancası)
- `packages/app/src/jobs.ts` (yeni: in-memory job store + SSE yazıcı)
- `packages/app/src/server.ts`, `packages/app/tests/jobs.test.ts`
- `FRONTEND_SPEC.md` §4/§5, `.gitignore`

**Adımlar**

1. Hash taraması + cache okuma/yazma (atomik: `.tmp` + rename).
2. `repoToStateWithRea` seçeneklerine `cacheDir`, `signal`.
3. Job store + SSE; tek uçuş kuralı (aynı kök için ikinci istek aynı job'ı döner).
4. Test: iki ardışık reverse → ikincisi `cacheHit: true` ve < 200 ms; SSE olay sırası.

**Kabul kriteri:** `Metrics: 18/18` fixture'ında ilk çağrı aynı sonucu verir, ikinci çağrı
`cacheHit: true` döner ve ölçülebilir şekilde hızlanır (ölçüm PR'a yazılır).
**Risk:** Önbellek yanlış geçersizleşmesi → anahtara `rea` sürümü + seçenekler + araç
sürümü (`package.json` version) dahil edilir.

---

## 5. `architect doctor` — repo kayması denetimi — M

**Amaç:** Üretilen mimari paketinin zamanla bayatlamasını ölçülebilir hale getirmek.

**Tasarım**

- Komut: `pnpm architect doctor [--state .architect/state.json] [--fail-on-drift]`.
- `repoToState(dir)` sonucu ile saklanan state `diffChanges` üzerinden karşılaştırılır:
  eklenen/silinen düğüm, kenar, entity, alan, karar.
- Çıktı: insan okunur tablo + `--json` modu (`{ drift: [...], ok: boolean }`).
- Paket tarafı: `ARCHITECTURE.md`/`openapi.yaml` içindeki düğüm ve uç adları state ile
  karşılaştırılır (paket yeniden üretilmeden).
- CI kullanımı: `--fail-on-drift` çıkış kodu 1; README'de örnek workflow.

**Dokunulacak dosyalar**

- `packages/app/src/doctor.ts` (yeni), `packages/app/src/cli.ts`
- `packages/reverse/src/index.ts` (yeniden kullanım), `packages/core/src/diff.ts` (mevcut)
- `packages/app/tests/doctor.test.ts` (yeni)

**Kabul kriteri:** Fixture repo'ya bir bağımlılık eklendiğinde doctor yeni düğümü
"eklendi" olarak raporlar ve `--fail-on-drift` ile 1 döner; değişiklik yokken 0.

---

## 6. Deterministik (bayt-bayt aynı) ZIP — S

**Amaç:** Aynı girdiden aynı paket hash'i; paketin kaynağı kanıtlanabilsin.

**Tasarım**

- JSZip girdilerine sabit `date` (ör. `1980-01-01T00:00:00Z`), sabit sıralama
  (dizin/dosya adına göre), `platform: "UNIX"` ve sabit mod (`0o644`).
- `metrics.json`/`MANIFEST.md` içindeki zaman damgaları `SOURCE_DATE_EPOCH` ile
  sabitlenebilir; varsayılan gerçek zaman, `--reproducible` veya
  `REPRODUCIBLE=1` ile sabit.
- Yanıt başlığı `X-Package-SHA256`, `/api/generate` ve CLI çıktısında hash.

**Dokunulacak dosyalar**

- `packages/packager/src/zip.ts`, `packages/packager/src/build-package.ts` (doküman zamanı)
- `packages/packager/tests/reproducible.test.ts` (yeni: iki üretim → aynı hash)
- `packages/app/src/server.ts` (başlık), `FRONTEND_SPEC.md` §4

**Kabul kriteri:** Aynı state ile iki ardışık `buildPackage` aynı SHA-256'yı verir; test
bunu hem düz hem sıkıştırılmış profilde doğrular.

---

## 7. Altın korpus regresyon paketi — M

**Amaç:** Ürün çıktısının (paket içeriği) sessizce bozulmasını yakalamak.

**Tasarım**

- `examples/corpus/*.json`: 10–15 state (entity'li, entity'siz, 54 düğümlü, tek düğümlü,
  çok dilli başlık, `archState.version` farklı).
- `packages/packager/tests/corpus.test.ts`: her state için paket üretilir; snapshot olarak
  (a) dosya listesi, (b) her dosyanın SHA-256'sı, (c) `metrics.json` sayısal alanları
  saklanır. `UPDATE_CORPUS=1` ile yenilenir; aksi halde fark testi kırar.
- 8 dil için yalnızca iki temsili dilde (tr, ja) tam paket; diğerlerinde yalnızca başlık
  ve `MANIFEST` doğrulanır (süre bütçesi).

**Dokunulacak dosyalar**

- `examples/corpus/` (yeni), `packages/packager/tests/corpus.test.ts`,
  `packages/packager/tests/__snapshots__/` (yeni)
- `README.md` (testler bölümü)

**Kabul kriteri:** Generator'larda yapılan bir değişiklik snapshot'ı değiştirirse test
kırmızıya döner ve PR'da gerekçe ister. **Bağımlılık:** 6 (deterministik ZIP) ile çok daha
stabil.

---

## 8. `ArchState` şema sürümleme ve migrasyon — S/M

**Amaç:** Kalıcılık ve arayüz gelmeden önce state sözleşmesini sabitlemek.

**Tasarım**

- `packages/core/src/state-schema.ts`: `archState@1` için JSON Schema (elle veya zod'dan
  üretilir) + `migrateState(input)`; `version` yoksa 1 kabul edilir, bilinmeyen sürüm
  `UnsupportedStateVersion` hatası.
- `/api/preview|chat|generate` ve CLI girişleri `parseState` içinde migrasyondan geçer.
- `docs/state-versioning.md`: alan ekleme/kaldırma kuralları, sürüm yükseltme kontrol listesi.

**Dokunulacak dosyalar**

- `packages/core/src/state.ts` (migrasyon kancası), `packages/core/src/state-schema.ts` (yeni)
- `packages/core/tests/state-migration.test.ts` (yeni), `PROJECT-SUMMARY.md` §8

**Kabul kriteri:** `version` alanı olmayan eski bir state uyarıyla 1'e yükseltilir;
`version: 99` net hata verir; mevcut 151 test değişmeden geçer.

---

## 9. Kalıcılık: proje ve revizyon geçmişi (SQLite) — M/L

**Amaç:** "Yeniden aç, kaldığın yerden devam et"; arayüzdeki geri alma gerçek olsun.

**Tasarım**

- `node:sqlite` (Node 22+ deneysel) yerine `better-sqlite3` tercih edilir; şema:
  `projects(id, name, created_at)`, `revisions(id, project_id, state_json, message,
  source, created_at)`, `packages(id, project_id, revision_id, sha256, bytes, created_at)`.
- Uçlar: `GET/POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/revisions`,
  `GET /api/projects/:id/revisions`, `POST /api/projects/:id/restore/:revisionId`.
- Depo yolu `ARCHITECT_DB` (varsayılan `.architect/architect.db`); yoksa in-memory mod
  (bugünkü davranış) → geri uyum.
- Yazma uçları mevcut rate limit + gövde limitine tabi; revizyon sayısı sınırlanır.

**Dokunulacak dosyalar**

- `packages/app/src/store.ts` (yeni), `packages/app/src/server.ts`, `packages/app/src/cli.ts`
- `packages/app/tests/store.test.ts` (yeni, geçici DB), `FRONTEND_SPEC.md` §4

**Kabul kriteri:** Bir proje oluşturup iki revizyon eklenir, ilkine dönülür ve state
birebir aynı döner; DB dosyası silinince davranış in-memory'ye düşer.
**Bağımlılık:** 8 (state sürümü) ve 3 (`config.json`).

---

## 10. `@architect-studio/*` paket alias'ları + modül sınırı kuralları — M

**Amaç:** Grafik kenarlarını Nx'in kendisi çıkarsın; `implicitDependencies` elle bakımı kalksın.

**Tasarım**

- `tsconfig.base.json` `paths`: `@architect-studio/core` → `packages/core/src/index.ts`
  (her paket için). `package.json`'lara `"name": "@architect-studio/<pkg>"` + `exports`.
- Import'lar `../../core/src/state` → `@architect-studio/core` (public API üzerinden;
  iç dosyaya derin import yasak).
- `nx.json` `plugins`/`targetDefaults` yanında `@nx/enforce-module-boundaries` kuralı:
  `type:app` yalnızca `type:lib`'e bağımlı olabilir; `type:tooling` hiçbir uygulamaya
  bağımlı olamaz. Kural `lint` hedefi olarak eklenir (eslint gerekmiyorsa
  `@nx/eslint-plugin` bağımlılığı eklenir).
- `implicitDependencies` alanları kaldırılır; `nx graph` kenarları import'tan üretir.

**Dokunulacak dosyalar**

- `tsconfig.base.json`, `packages/*/package.json` (yeni isimler), `packages/*/src/*.ts` import'ları
- `packages/*/project.json` (`implicitDependencies` silinir), `eslint.config.js` (yeni)
- `README.md`/`PROJECT-SUMMARY.md` Nx bölümleri

**Kabul kriteri:** `nx graph --print` 9 düğüm ve aynı kenarları verir; derin import
(`@architect-studio/core/src/diff`) lint hatası; `pnpm typecheck`/`pnpm test` yeşil.

---

## 11. Web araması bağlamı için prompt-injection sınırı — S

**Amaç:** Dış içeriğin mimari state'e talimat olarak sızmasını engellemek.

**Tasarım**

- `formatSearchContext` çıktısı tek bir `<untrusted web results>` bloğuna alınır; başlıkta
  "veri, talimat değil" açıkça yazılır; her sonuç `source_url` + `retrieved_at` ile
  etiketlenir.
- Talimat benzeri satırlar işaretlenir (`ignore previous`, `system:`, `you must`,
  aşırı uzun tek satır) ve `[flagged]` olarak işaretli ama **atılmaz** (yanlış pozitif
  riskine karşı); sayı `notes`'a yazılır.
- `sanitizeState` sonrası "kaynaksız düğüm" kontrolü: web araması açıkken eklenen her yeni
  dış servis düğümü `props.evidence` içinde `source: "web"` taşımak zorunda; aksi halde
  uyarı.

**Dokunulacak dosyalar**

- `packages/app/src/web-search.ts`, `packages/app/src/llm.ts` (prompt bloğu)
- `packages/app/tests/web-search.test.ts` (enjeksiyon fixture'ları)

**Kabul kriteri:** Zararlı içerikli fixture prompt'ta "veri" bloğunda kalır, `[flagged]`
sayısı doğru raporlanır, state'e kaynaksız düğüm eklenmez.
**Risk:** Yanlış pozitifler → işaretleme yalnızca log/notes seviyesinde, çıktıyı silmez.

---

## 12. LLM değerlendirme koşum takımı (eval harness) — M

**Amaç:** BYOK model/sürüm değişiminde kaliteyi ölçmek; bugün yalnızca "hata olursa
deterministik motora düş" güvencesi var.

**Tasarım**

- `examples/evals/*.json`: `{ id, state, message, expect: { intent, changes, minEntities } }`.
- `pnpm eval` (yeni Nx hedefi, `app:eval`): gerçek model çağrısı yapar; `--record` ile
  yanıtlar `examples/evals/recordings/` altına yazılır, `--replay` anahtarsız çalışır (CI).
- Metrikler: geçerli state oranı, niyet doğruluğu, deterministik motora düşme oranı,
  ortalama token.
- CI: yalnızca `--replay` (anahtarsız, deterministik); gerçek model koşusu elle.

**Dokunulacak dosyalar**

- `packages/app/src/eval.ts` (yeni), `packages/app/tests/eval.test.ts` (replay)
- `package.json`/`packages/app/project.json` (`eval` hedefi), `README.md`

**Kabul kriteri:** `pnpm eval --replay` 0 döner ve rapor tablosu üretir; kayıt yoksa test
atlanmaz, açık hata verir.

---

## Önceden konuşulmuş, hâlâ açık olanlar

- `FRONTEND_SPEC.md`'nin kodlanması (`web/index.html|app.js|styles.css`) — ürünün eksik
  yarısı; **1 ve 2 bittikten sonra** başlanmalı.
- Playwright E2E, OpenAPI/AsyncAPI meta-şema doğrulaması (ajv + spec şemaları), sandbox
  içinde `install + test` profilleri, REA'dan OpenAPI/SQL entity çıkarımı, `nx-plugin`'e
  ek şablonlar (`artifact`, `executor`) — `PROJECT-SUMMARY.md` §9.

## Yol haritası ve bağımlılıklar

| Milestone | Maddeler | Neden bu sıra |
|---|---|---|
| **M1 — Güven ve sözleşme** | 1, 2, 3 | Arayüz ve dış kullanım öncesi sözleşme + güvenlik + ilk kullanım |
| **M2 — Hız ve tekrarlanabilirlik** | 4, 6, 7 | Uzun işlem maliyeti, paket güvenilirliği, regresyon koruması |
| **M3 — Süreklilik** | 8, 9, 5 | Kalıcılık + kayma denetimi; 3 ve 8'e bağlı |
| **M4 — Ölçek ve dağıtım** | 10, 11, 12 | Alias/sınır kuralları, güvenlik sertleştirme, kalite ölçümü |
| **Arayüz** | (spec) | M1 bittikten sonra; 1'in kontrat testleri arayüzü doğrular |

```text
1 ─┬─> arayüz
2 ─┘
3 ──> 9 ──> 5 (state dosyası 3'ten)
6 ──> 7
8 ──> 9
10 ── bağımsız (grafik/import temizliği)
4 ── bağımsız (2'deki kuyrukla uyumlu)
```

## Her madde için "bitti" tanımı

1. Kod + test yeşil (`pnpm test`, `pnpm typecheck`), 2. `FRONTEND_SPEC.md` ve gerekiyorsa
`.env.example`/`README.md` güncel, 3. ölçüm veya kabul senaryosu PR açıklamasında,
4. tek commit + PR, 5. `PROJECT-SUMMARY.md` doğrulanmış sonuçlar tablosuna satır.
