# Açık konular — 2026-11-28 oturumu (güncellendi)

Bu dosya oturum boyunca kapatılan ve kapatılamayan hataları/eksikleri listeler.

## Bu turda kapatıldı

| Konu | Kanıt |
|---|---|
| Mermaid şemaları render edilemiyordu | `readme-diagrams.test.ts`: README.md + README.tr.md'deki **22 blok** jsdom altında `mermaid.parse` ile geçti; arayüzde de gerçek SVG render edildi |
| `pnpm eval --record` gerçek modelle denenmemişti | `eval-record.test.ts`: yerel OpenAI-uyumlu HTTP sunucusuna karşı `--record` çalıştı, kayıt yazıldı, replay endpoint'siz geçti |
| Canlı web arama sağlayıcıları denenmemişti | DuckDuckGo anahtarsız yolu gerçek ağa karşı denendi: `kubernetes` → 3 sonuç + URL |
| `architect doctor --help` hata veriyordu | Ortak yardım: `--help`/`-h` her alt komutta çıkış 0; `cli-help.test.ts` 3 test |
| CLI bayraklarında ortak yardım yoktu | `helpText(topic)` tek kaynak; init/doctor/projects/eval başlıkları + `--version` |
| Arayüz (`FRONTEND_SPEC.md`) kodlanmamıştı | `web/index.html`, `web/styles.css`, `web/app.js`: 10 görünüm, Mermaid, SSE reverse, sandbox konsolu, 8 dil, koyu/açık tema; `web-ui.test.ts` 4 test; tarayıcıda preview → diyagram + 3 entity + 18 metrik, sohbetle `Order.priorityCount`, TR'ye canlı geçiş |
| OpenAPI/SQL entity çıkarımı yoktu | `components.schemas`/Swagger `definitions` entity'ye dönüşür; tip eşlemesi + `$ref` ilişkileri; `openapi.test.ts` 2 test (SQL çıkarımı hâlâ yok) |
| `node:sqlite` deneysel uyarısı | Uyarı yalnızca modül yüklenirken susturulur, dinleyiciler geri konur; çalıştırmada uyarı yok |
| Şema migrasyon çerçevesi yoktu | `PRAGMA user_version` + sıralı `MIGRATIONS`; `schemaVersion` 1, dosya yeniden açılışta korunur; `store-schema.test.ts` |

## Kapatılamayan / bilinçli kalanlar

1. **Gerçek sağlayıcı anahtarıyla `--record` denenmedi.** Uçtan uca HTTP yolu stub ile
   doğrulandı; OpenAI/Anthropic faturalı anahtarı oturumda yoktu.
2. **Tavily/Brave canlı yolları denenmedi.** Anahtar yok; yalnızca sahte `fetch` testleri
   ve DuckDuckGo canlı testi var.
3. **Docker imajı yerelde build edilmedi.** Makinede `docker` yok; CI `docker` işi imajı
   başarıyla derliyor (run `46137330642`).
4. **Playwright E2E ve ajv meta-şema doğrulaması yok.** Tarayıcı akışı bu turda elle
   (preview araçlarıyla) doğrulandı ve jsdom testleri eklendi; otomatik tarayıcı suite'i
   ve OpenAPI/AsyncAPI şema doğrulaması eklenmedi.
5. **Sandbox `install + test` profilleri yok.** Yalnızca sürücü algılama + tek komut
   yürütme var; ağ üzerinden bağımlılık kurulumu bilinçli olarak eklenmedi.
6. **Modül sınırı kuralı lint değil test.** `@nx/enforce-module-boundaries` yerine
   `module-boundaries.test.ts`; editörde anlık uyarı vermez.
7. **Kümeleme / uzak veritabanı yok.** SQLite dosyası WAL + `busy_timeout` ile çok
   süreçli yazmaya dayanıklı; şema sürümü artık izleniyor ama kümeleme yok.
8. **Arayüz metinlerinin bir kısmı yalnızca İngilizce.** Katalogda anahtarı olan metinler
   (`ui.preview`, `ui.chatTitle`, …) çevriliyor; gezinme/başlık gibi yeni metinler şimdilik
   İngilizce sabit — katalog anahtarları eklenmeli.

## Doğrulama özeti

- `pnpm typecheck` 9/9, `pnpm test` **338/338** (41 dosya, 8 paket, `--skip-nx-cache`),
  `pnpm install --frozen-lockfile` temiz.
- Tarayıcı: 10 görünüm yüklendi, konsol hatası yok; preview → SVG diyagram, 3 entity,
  18 metrik, 2 görev, 17 artifact; sohbet `Order.priorityCount` ekledi; dil TR'ye geçti.
- Canlı DuckDuckGo: `kubernetes` → 3 sonuç.
