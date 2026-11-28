# Açık konular — 2026-11-28 oturumu

Bu dosya oturum boyunca kapatılamayan veya bilinçli olarak ertelenen hataları ve
eksikleri listeler. Yalnızca çalışma ağacında (worktree) commit edilir, `main`'e
gönderilmez.

## Bu oturumda kapatıldı (referans)

| Konu | Durum |
|---|---|
| CI test zaman aşımı (sandbox sürücü yoklaması) | Kapandı: yoklama 2 sn + süreç ağacı öldürme (`e94438a`) |
| MIT → Apache 2.0 geçişi | Kapandı: kanonik `LICENSE`, `package.json`, iki README (`485b03a`); depoda kalan MIT referansı yok |
| Node 20 uyarısı (GitHub Actions) | Kapandı: `actions/checkout@v6`, `actions/setup-node@v7`, `pnpm/action-setup@v6`; CI run `46137330642` verify + docker yeşil, loglarda Node 20/deprecation satırı yok |
| m10 paket alias'ları + modül sınırı | Kapandı: 9 düğüm/9 kenar `nx graph --print`, sınır testi 3/3 |
| m11 prompt-injection sınırı | Kapandı: untrusted blok + `[flagged]` + kanıt denetimi, 4 yeni test |
| m12 eval harness | Kapandı: replay 2/2 (ort. 294 token), 4 test |

## Giderilemeyen / doğrulanamayan hatalar

1. **Mermaid şemaları yerelde render edilemedi.** 11 diyagramlı README'ler
   (`README.md`, `README.tr.md`) yalnızca sözdizimi düzeyinde gözden geçirildi;
   `DOMPurify.addHook is not a function` ve DOM olmaması nedeniyle gerçek render
   doğrulanamadı. GitHub üzerinde görsel kontrol gerekli.
2. **`pnpm eval --record` gerçek modelle denenmedi.** Oturumda API anahtarı yoktu;
   yalnızca `--replay` ve enjekte edilmiş üretici ile `--record` yolu test edildi.
   Gerçek sağlayıcı yanıtı, token/gecikme davranışı ve hata yolları doğrulanmadı.
3. **Canlı web arama sağlayıcıları denenmedi.** Tavily, Brave ve DuckDuckGo yolları
   yalnızca sahte `fetch` ile test edildi; gerçek ağ yanıtları, kota/hız limiti
   davranışı ve snippet biçimleri doğrulanmadı.
4. **`architect doctor --help` hata veriyor.** `pnpm architect doctor --help`
   "Unknown option for doctor: --help" ile çıkış 1 döndürüyor; diğer alt komutlarda
   yardım çıktısı tutarlı değil. Kullanılabilirlik hatası, oturum kapsamı dışı bırakıldı.
5. **CLI bayraklarında ortak yardım yok.** `architect` kök komutu ve alt komutlar
   için `--help`/`--version` çıktısı ayrı ayrı elle yazılmış; tek kaynak yok.

## Bilinçli eksikler (plan/proje notlarında zaten açık)

6. **Modül sınırı kuralı lint değil test.** Plan `@nx/enforce-module-boundaries`
   (eslint) öngörüyordu; bağımlılık eklememek için kural
   `packages/app/tests/module-boundaries.test.ts` içinde Vitest ile uygulanıyor.
   Kural ancak test koşulduğunda devreye girer, editörde anlık uyarı vermez.
7. **Arayüz (`FRONTEND_SPEC.md`) hâlâ kodlanmadı.** Ürünün eksik yarısı; sözleşme
   testleri hazır ama `web/index.html|app.js|styles.css` yok.
8. **Playwright E2E ve meta-şema doğrulaması yok.** OpenAPI/AsyncAPI çıktıları
   şema ile (ajv) doğrulanmıyor, tarayıcı E2E testi yok.
9. **Sandbox `install + test` profilleri yok.** Yalnızca sürücü algılama ve tek
   komut yürütme var; bağımlılık kurulumu + test profili çalıştırılmıyor.
10. **REA'dan OpenAPI/SQL entity çıkarımı yok.** Prisma ve Compose destekli;
    OpenAPI dosyalarından entity/edge üretimi eklenmedi.
11. **`node:sqlite` deneysel uyarısı sürüyor.** Depo yerleşik modülü kullandığı için
    Node çalıştırmalarında deneysel API uyarısı basılıyor; API kararlı ama uyarı
    filtrelenmiyor.
12. **Kümeleme / migrasyon çerçevesi yok.** SQLite dosyası çok süreçli yazmaya
    dayanıklı (WAL + `busy_timeout`), ancak şema migrasyon aracı veya uzak veritabanı
    desteği yok.

## Notlar

- Bu oturumdaki doğrulamalar: `pnpm typecheck` 9/9, `pnpm test` 325/325 (35 dosya,
  8 paket, `--skip-nx-cache`), `pnpm install --frozen-lockfile` temiz,
  `pnpm eval` replay 2/2, CI run `46137330642` başarılı.
- Docker imajı bu makinede yerel olarak build edilmedi; CI `docker` işi imajı
  başarıyla derledi.
