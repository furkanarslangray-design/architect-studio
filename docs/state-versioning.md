# `ArchState` şema sürümleme

`ArchState`, pipeline'a giren ve paketten çıkan mimari durumun tek sözleşmesidir
(`packages/core/src/state.ts`). Kalıcılık ve arayüz geldiğinde eski kayıtların hâlâ
açılabilmesi için sürüm alanı ve migrasyon tek bir yerde tutulur:
`packages/core/src/state-schema.ts`.

## Bugünkü sözleşme

| Alan | Değer |
|---|---|
| `CURRENT_STATE_VERSION` | `1` |
| `SUPPORTED_STATE_VERSIONS` | `[1]` |
| JSON Schema | `ARCH_STATE_JSON_SCHEMA` / `stateJsonSchema()` → `arch-state-v1.json` |
| `version` yoksa | `1` kabul edilir, `migrateState` uyarı döndürür |
| Bilinmeyen sürüm | `UnsupportedStateVersionError` (`code: "unsupported_state_version"`) |

Giriş noktalarının tamamı (`/api/preview|chat|generate` gövdesi, CLI dosyaları, MCP
araçları) `parseState` / `safeParseState` üzerinden geçtiği için migrasyonu ayrıca
çağırmaz. `safeParseState` bilinmeyen sürümü `version` yolunda bir zod hatasına çevirir;
`parseState` tipli hatayı fırlatır. Bilinmeyen bir sürümü sessizce 1'e indirmek yasaktır:
yeni yazıcının ürettiği alanlar kaybolur.

### Uyarıların görünürlüğü

Uyarılar sessizce yutulmaz:

- `parseStateReport` / `safeParseStateReport` migrasyon uyarılarını `warnings`
  alanında döndürür; `parseState` / `safeParseState` bunları düşürür, böylece
  mevcut çağıranların imzası değişmez.
- `/api/preview`, `/api/chat` ve `/api/sandbox` yanıtları, gövdede `state`
  verildiğinde ve migrasyon gerektiğinde `stateWarnings: string[]` döndürür;
  `/api/generate` aynı sayıyı `X-State-Warnings` başlığında verir.
- CLI (`--json`) uyarıları stderr'e `State migration: …` olarak yazar, böylece
  `--preview` çıktısı makine tarafından okunabilir kalır.

## Alan ekleme kuralları

1. **Geriye uyumlu (varsayılanı olan) alan** — ör. yeni bir opsiyonel `props` anahtarı:
   sürüm artırmadan eklenebilir. `zod` şemasına `.default(...)` ver, JSON Schema'ya `default`
   yaz, mevcut state'ler parse edilmeye devam eder.
2. **Anlamı değişen veya zorunlu hale gelen alan** — sürüm artırılır. Eski kayıtlar
   `migrateState` içinde yeni şekle çevrilir; migrasyon adımı `1 → 2` gibi açıkça yazılır.
3. **Alan kaldırma** — önce iki sürüm boyunca opsiyonel tut, sonra sürüm artırıp migrasyonda
   düşür. Migrasyon, kaldırılan alanı sessizce silmek yerine gerekiyorsa yeni alana taşır.
4. **Enum genişletme** (yeni `kind`, `protocol`, `field type`) — eski okuyucu bilinmeyen değeri
   reddedeceği için sürüm artışı gerektirir; daraltma da aynı şekilde.

## Sürüm yükseltme kontrol listesi

- [ ] `SUPPORTED_STATE_VERSIONS` ve `CURRENT_STATE_VERSION` güncellendi.
- [ ] `migrateState` içinde `n → n+1` adımı eklendi; adım idempotent ve saf (girdiyi mutasyona
      uğratmıyor).
- [ ] `ArchStateSchema` yeni sürümü kabul ediyor, eski sürümü reddediyor.
- [ ] `ARCH_STATE_JSON_SCHEMA` (ve `$id`) yeni sürüme kopyalandı; eski sürüm dosyası silinmedi.
- [ ] `packages/core/tests/state-migration.test.ts`: eski kayıt → yeni sürüm, bilinmeyen sürüm →
      hata, `safeParseState` yolunda alan hatası test edildi.
- [ ] `examples/corpus/` içine eski sürümden bir state eklendi ve
      `UPDATE_CORPUS=1 pnpm nx run packager:test` ile snapshot yenilendi (diff gerekçelendirildi).
- [ ] `docs/state-versioning.md` tablosu ve `PROJECT-SUMMARY.md` güncellendi.
- [ ] `FRONTEND_SPEC.md` içinde sürümden etkilenen yanıt alanları varsa güncellendi.

## Hata davranışı

| Girdi | Sonuç |
|---|---|
| `version` yok | `1`, `warnings: ["state.version is missing; assuming 1…"]` |
| `version: 1` | değişmeden geçer |
| `version: 99` (veya `0`, `-1`, `"1"`) | `UnsupportedStateVersionError`; HTTP katmanında `invalid_state` yanıtı |
| nesne değil / dizi | zod şekil hatası (`root`) |

`version: 0` veya `"1"` gibi değerler de bilinmeyen sürüm sayılır: sürüm alanı sayı olmayan
bir kayıt, hangi şemayla yazıldığını söylemiyordur.
