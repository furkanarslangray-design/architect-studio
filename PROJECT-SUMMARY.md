# PROJECT-SUMMARY — AI Principal Architect (MVP)

Yeni geliştirici devir teslim notu. Son güncelleme: 2026-11-22.

## 1. Proje nerede?

**Klasör:** `/home/furkanarslangray/architect-studio`
**Branch:** `mvp` (henüz remote'a push edilmedi)
**Son commit:** `ea15371 fix: scale parallel_groups target to architecture size`

Çalıştırmak için:

```bash
cd /home/furkanarslangray/architect-studio
pnpm install          # bağımlılıklar zaten kurulu
pnpm dev              # http://localhost:3000
```

Gereksinim: Node >= 22, pnpm.

## 2. Proje ne yapıyor?

Doğal dildeki bir fikri alır; doğrulanmış bir **ajan paketi** (ZIP) üretir:

1. Fikri `ArchState` modeline çevirir (demo modu deterministik, BYOK modu OpenAI-uyumlu LLM).
2. OpenAPI 3.1, Prisma, AsyncAPI, Mermaid, `ARCHITECTURE.md`, `WHITEPAPER.md`, ADR'ler üretir.
3. Artifact'ları deterministik olarak doğrular; gerekirse 2 tura kadar self-heal yapar.
4. `TASKS.md` + `tasks/T-*.md` dilimlenmiş görev paketleri üretir (token bütçeli, bağımlılıklı).
5. `.opencode/agents/{implementer,validator,reviewer}.md` subagent tanımlarını ekler.
6. `metrics.json` + `MANIFEST.md` ile birlikte ZIP olarak paketler.

Temel akış:

```
idea ──> ideaToState() ──> ArchState ──> buildPackage()
                                          ├─ generators (OpenAPI/Prisma/AsyncAPI/Mermaid/docs)
                                          ├─ task packets (TASKS.md + tasks/T-*.md)
                                          ├─ OpenCode agents
                                          ├─ validators (+ self-heal)
                                          └─ metrics + MANIFEST + ZIP
```

## 3. Dosya yapısı

```
architect-studio/
├─ package.json                 # script'ler ve kök bağımlılıklar
├─ pnpm-workspace.yaml
├─ tsconfig.json                # CommonJS, ES2022, strict, noEmit
├─ vitest.config.ts             # packages/**/tests/**/*.test.ts
├─ README.md                    # kısa kullanım
├─ PROJECT-SUMMARY.md           # bu dosya
├─ web/
│  └─ index.html                # tek sayfalık web UI (statik HTML + fetch)
├─ .opencode/agents/            # bu repo için implementer/validator/reviewer
├─ docs/superpowers/
│  ├─ specs/2026-11-22-agent-package-design.md
│  └─ plans/2026-11-22-usable-mvp.md
├─ .superpowers/sdd/progress.md # görev/commit ledger'ı
└─ packages/
   ├─ core/                     # state, diff, ids, metrics, task-packet
   │  ├─ src/{state,diff,ids,metrics,task-packet}.ts
   │  └─ tests/{state,diff,task-packet}.test.ts
   ├─ generators/               # openapi, prisma, asyncapi, mermaid, docs/ADR
   │  ├─ src/{openapi,prisma,asyncapi,mermaid,docs,util,index}.ts
   │  └─ tests/ + tests/fixtures/{minimal,ecommerce}.json
   ├─ validators/               # deterministik doğrulama + self-heal
   │  └─ src/{index,self-heal}.ts + tests/
   ├─ packager/                 # ZIP, metrics, MANIFEST, OpenCode agents, redaction
   │  └─ src/{build-package,opencode-agents,report,zip,index}.ts + tests/
   └─ app/                      # demo/LLM üretici, pipeline, HTTP server, CLI
      └─ src/{demo,llm,pipeline,server,cli}.ts + tests/{app,server}.test.ts
```

`out/` ve `*.zip` git'e girmez; üretilen paketler geçicidir.

## 4. Çalışan özellikler (doğrulandı)

- **Demo modu:** API anahtarı olmadan çalışır. Anahtar kelimelerden (postgres/db, redis/queue, react/web/ui ve bazı Türkçe karşılıklar) deterministik mimari üretir.
- **BYOK modu:** OpenAI-uyumlu `/v1/chat/completions`; `apiKey`, `baseUrl`, `model`. 1 kez retry, 60 sn timeout, Zod ile state doğrulama.
- **Gizli anahtar güvenliği:** Anahtar diske/loga yazılmaz; üretilen tüm dosyalardan string ve `sk-...` deseni redakte edilir.
- **State doğrulama:** Benzersiz node/edge id, dangling edge, self-loop ve cycle kontrolü.
- **Görev paketleri:** Her node için bağımsız paket; bağımlılıklar edge yönünden, dalga (wave) ve token tahminiyle.
- **Artifact üretimi:** OpenAPI 3.1, Prisma schema, AsyncAPI 2.6, Mermaid flowchart, ARCHITECTURE/WHITEPAPER/AGENTS/.cursorrules, ADR'ler.
- **Deterministik doğrulama:** YAML parse, `$ref` çözümü, Prisma brace dengesi, Mermaid başlığı, TASKS tablosu, metrics varlığı.
- **Self-heal:** Eksik OpenAPI/AsyncAPI başlığı, boş Mermaid, TASKS tablosu gibi durumları LLM'siz onarır (en fazla 2 tur).
- **Web UI:** Fikir formu, demo/BYOK alanları, ZIP indirme, `X-Metrics-Passed`, `X-Task-Count`, `X-Validation` başlıklarıyla özet.
- **CLI:** `--idea`, `--json`, `--out`, `--demo`, `--api-key`, `--base-url`, `--model`.
- **Çıktı metrikleri:** Paket boyutu, token p95/max, context oranı, duplicate context, dosya/görev, bağımlılık derinliği, kapsam, validator pass, self-heal, unresolved ref, süre.

Doğrulanmış sonuçlar:

| Kontrol | Sonuç |
|---|---|
| `pnpm test` | 42/42 test geçti |
| `pnpm typecheck` | temiz |
| `pnpm build` | temiz (typecheck + test) |
| Referans mimari (`postgres redis react api`) | 17/17 metrik, doğrulama ok |
| Minimal mimari (`an app`) | 17/17 metrik, doğrulama ok |
| Tarayıcı smoke testi | Form → ZIP indirme çalıştı |

## 5. Test haritası

| Paket | Test sayısı | Kapsam |
|---|---|---|
| `core` | 15 | state parse, diff/cycle, task packet + metrikler |
| `generators` | 6 | OpenAPI/Prisma/AsyncAPI/Mermaid/docs, isim çakışması |
| `validators` | 5 | geçerli set, bozuk `$ref`, Prisma brace, self-heal |
| `packager` | 5 | ZIP içeriği, metrikler, minimal mimari, redaction, geçersiz state |
| `app` | 11 | demo, BYOK retry/timeout/redaction, pipeline, HTTP server |

## 6. Eksikler / bilinen sınırlar

### Üretim kalitesi
- **Görev metinleri şablon:** LLM yalnızca mimari state'i üretir; `tasks/T-*.md` içerikleri node türüne göre şablonlanır.
- **OpenAPI yüzeysel:** Servis başına `/health` ve `/api/<slug>`; şemalar generic `Item`. Gerçek domain modelleri yok.
- **Prisma tek tip:** Her zaman `provider = "postgresql"`; `props.engine` dikkate alınmıyor.
- **Verify komutları hedef repoyu varsayar:** `pnpm vitest ...` üretilir; hedef projede pnpm/vitest yoksa komut çalışmaz.
- **Kabul kriterleri çalıştırılmaz:** Üretilir ama gerçek bir hedef kod tabanında doğrulanmaz.

### Doğrulama / metrikler
- `deterministicCoverage` şu an sabit `1`; yalnızca 7 kontrolü kapsar ve gerçek kapsamı ölçmez.
- OpenAPI/AsyncAPI için tam JSON Schema validasyonu yok; parse + basit `$ref` kontrolü var.
- Token tahmini `karakter / 4`; gerçek tokenizer değil.
- `duplicateContextRatio` yalnızca birebir aynı context'i yakalar.
- `parallel_groups` hedefi `min(3, node sayısı)`; küçük mimarilerde esnek.

### Test boşlukları
- Gerçek bir OpenAI-uyumlu sağlayıcıya karşı canlı BYOK testi yok; testler mock'lu.
- Tarayıcı testi manuel yapıldı; otomatik E2E (Playwright) yok.
- ZIP'in gerçekten indirildiği değil, UI'da "Paket hazır" durumuna gelindiği doğrulandı.
- Yük testi, eşzamanlı istek ve büyük state performansı test edilmedi.

### Altyapı / ürün
- Kimlik doğrulama, kullanıcı/oturum, kalıcılık, rate limit yok; sunucu tek süreç ve in-memory.
- Docker, CI, LICENSE, `.env.example` yok.
- Web UI statik; üretilen mimariyi önizleme/düzenleme ekranı yok.
- Arayüz metinleri Türkçe, backend hata mesajları İngilizce.
- `web/index.html` `process.cwd()` üzerinden okunur; sunucu repo kökünden çalıştırılmalı.
- Kapsam dışı (bilinçli): AST/tersine mühendislik, FinOps, STRIDE/compliance, masaüstü, MCP, Mock & Trace.

## 7. Yeni geliştirici için önerilen ilk adımlar

1. `pnpm test && pnpm typecheck` ile başla.
2. `pnpm dev` + tarayıcıda demo moduyla bir paket üret, ZIP'i incele.
3. Gerçek bir OpenAI-uyumlu endpoint ile BYOK akışını manuel dene (anahtarı commit etme).
4. İlk iyileştirme adayları:
   - Domain bazlı OpenAPI/Prisma üretimini state'ten türet.
   - `verifyCommand`'ı hedef projenin paket yöneticisine göre yapılandırılabilir yap.
   - Gerçek tokenizer ve daha güçlü kapsam metriği ekle.
   - Playwright ile indirme E2E testi ekle.
   - CI + Docker + LICENSE ekle.

## 8. Faydalı komutlar

```bash
pnpm dev
pnpm test
pnpm test:watch
pnpm typecheck
pnpm build

# Demo paket
pnpm generate -- --idea "Postgres, Redis events, React storefront" --demo

# Mevcut state'ten paket
pnpm generate -- --json architecture.json --out out/package.zip

# BYOK
pnpm generate -- --idea "..." --api-key sk-... --model gpt-4o-mini
```
