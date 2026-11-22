# AI Principal Architect — Agent Package MVP Design

## Intent

Vibe coding yapan geliştiricilerin kafalarındaki sistemi, doğal dilden alıp OpenCode
subagent'larının düşük token ile inşa edebileceği doğrulanmış bir ajan paketine
dönüştürmek.

Başarı: kullanıcı fikrini yazar, sistem mimari state'i üretir, deterministik olarak
doğrular ve indirilebilir bir ZIP verir. ZIP içinde `ARCHITECTURE.md`, `TASKS.md`,
`tasks/T-*.md`, `.opencode/agents/*.md`, OpenAPI/Prisma/AsyncAPI/Mermaid, ADR'ler,
Whitepaper ve `metrics.json` bulunur.

## Goals

- Tek oturumda çalışan, tarayıcıdan kullanılabilir MVP.
- BYOK: OpenAI-uyumlu tek sağlayıcı; anahtar sadece istek süresince kullanılır, diske yazılmaz.
- Anahtarsız demo modu: basit anahtar kelime tabanlı state üretimi.
- Her görev paketi kendi kendine yeterli; subagent tüm dokümanı okumak zorunda değil.
- Tüm üretilen artifact'lar LLM olmadan deterministik doğrulanır.
- Tüm çıktı metrikleri `metrics.json` içinde raporlanır.

## Non-Goals

- Tersine mühendislik / AST tarayıcı.
- FinOps maliyet motoru.
- STRIDE / KVKK / GDPR / PCI-DSS denetimi.
- İlk sürümde sürükle-bırak tuval, sürüm diff UI, Mock & Trace, MCP, masaüstü.
- Çok kullanıcılı hesaplar, veritabanı, kimlik doğrulama.

## Anti-Goals

- Aracın uygulama kodunu kendisi yazması. Çıktı, kodlama ajanına verilecek tariftir.
- Büyük tek parça `TASKS.md` üretip subagent'a tüm bağlamı okutmak.
- API anahtarını loglamak, ZIP'e koymak veya repoya yazmak.

## Architecture

```text
[Fikir]
  → LLM / demo parser
  → ArchState (Zod ile doğrulanmış)
  → üreticiler (OpenAPI, Prisma, AsyncAPI, Mermaid, dokümanlar)
  → deterministik doğrulayıcı (parse + yapısal kontroller)
  → TaskPacketBuilder (dizin + dilimlenmiş görev dosyaları + OpenCode agent tanımları)
  → Packager (ZIP + metrics.json + MANIFEST.md)
  → tarayıcıdan indirme / CLI çıktısı
```

Tek kaynak `ArchState`'tir. Tuval ileride bu state'i düzenleyen bir arayüz olacaktır;
MVP'de giriş doğal dil ve JSON importtur.

## Approaches Considered

1. **Tek büyük TASKS.md + Whitepaper.** Basit ama her subagent tüm bağlamı okur; token hedefiyle çelişir. Reddedildi.
2. **Dilimlenmiş görev paketleri.** `TASKS.md` dizin; `tasks/T-*.md` her biri tek subagent için. Seçildi.
3. **MCP ile canlı state sorgulama.** Esnek ama MVP için gereğinden ağır. Sonraki faz.

## Key Decisions

- **Dilimlenmiş görev paketleri** seçildi; token verimliliği ürünün ana değeri.
- **Tek provider (OpenAI-uyumlu)** ile BYOK; anahtar sunucuda tutulmaz.
- **Demo modu** anahtarsız denemeyi mümkün kılar.
- **Deterministik doğrulama** kendi hafif denetleyicilerimizle yapılır; MVP'de harici CLI bağımlılığı yok.
- **Web arayüzü** bağımlılıksız statik HTML + Node HTTP sunucusu; Next.js/React Flow sonraki faz.
- **MCP ve masaüstü** sonraki faz.

## Output Metrics

| Metric | Target |
|---|---|
| packet_prompt_tokens p95 | ≤ 1500 |
| packet_prompt_tokens max | ≤ 2500 |
| context_slice_ratio | ≤ 10% |
| duplicate_context_ratio | ≤ 5% |
| files_per_task | 1–5 |
| dependency_depth | ≤ 4 |
| subagent_steps | ≤ 8 |
| contract_coverage | 100% |
| acceptance_coverage | 100% |
| validator_pass_rate | 100% |
| self_heal_rounds | ≤ 2 |
| unresolved_refs | 0 |
| deterministic_coverage | ≥ 90% |
| index_tokens | ≤ 800 |
| package_size_kb | ≤ 500 |
| state_to_package_ms p95 | < 10000 |

## Constraints

- TypeScript, Node 22, pnpm.
- Ağ yalnızca LLM çağrısı için; üretim ve doğrulama yerel.
- Anahtar loglara, ZIP'e veya metrics'e yazılmaz.
- OpenCode V2 `mode: subagent` tanımları üretilir; `steps` ≤ 8.
- Testler Vitest ile; her görev kendi testini içerir.

## Risks

- LLM'in geçerli JSON üretmemesi → Zod doğrulama + tek yeniden deneme + demo fallback.
- Görev paketlerinin çok büyümesi → token bütçesi testi ve otomatik dilimleme.
- Yanlış pozitif doğrulama → golden fixture testleri ve yapısal kontroller.

## v0.2 Uygulama Notları (2026-11-22)

### ArchState genişlemesi

`ArchState.entities` eklendi. Her entity `fields` (tip, `required`, `unique`, `primary`),
`serviceId`, `databaseId` ve `relations` taşır. Tek kaynak kuralı korunur: OpenAPI, Prisma,
dokümanlar ve görev paketleri bu tek state'ten türetilir. Entity tanımlanmazsa servis başına
generic `Item` fallback'i kullanılır. LLM çıktısı `sanitizeState` ile deterministik olarak
temizlenir (duplicate/dangling/self-loop/missing referans).

### Metrik revizyonu

- Token sayımı `gpt-tokenizer` (cl100k_base) ile gerçek BPE sayımıdır.
- `context_slice_ratio` paydası tüm pakettir (state + görev paketleri + index + üretilen
  artifact'lar); bir paketin bağlam dilimi gerçekten gezilecek malzemeye göre ölçülür.
- `parallel_groups` hedefi `min(3, node sayısı − 1)`; küçük DAG'lerde ulaşılamaz hedef üretmez.
- `deterministic_checks` (≥ 10) gerçek kontrol sayısını raporlar.
- `deterministic_coverage`, paketteki artifact türlerinden deterministik doğrulayıcısı
  olanların oranıdır; doğrulanamayan dosya eklendiğinde düşer ve issue üretir.

### Doğrulama ve API

- OpenAPI/AsyncAPI için benzersiz `operationId`, cevap nesneleri, tam `$ref` çözümü ve
  yapısal JSON Schema kontrolü (`required` ↔ `properties`, `items`, tip/format/enum).
- Paketleme sırasında `tasks/<ID>.md` dosyalarının varlığı ve içeriği doğrulanır.
- `POST /api/preview` ZIP üretmeden state/görev/metrik/doğrulama döner; `POST /api/generate`
  `idea` veya `state` kabul eder. Runtime seçimleri (`packageManager`, `testRunner`) API,
  CLI ve web UI'dan geçirilir. IP başına dakikalık rate limit ve 256 KB gövde limiti vardır.

### Altyapı

Dockerfile + healthcheck, `.env.example`, MIT lisansı ve GitHub Actions CI eklendi.
Tarayıcı E2E ve tam OpenAPI meta-şema doğrulaması hâlâ kapsam dışıdır; bunlar sıradaki
iyileştirme adaylarıdır.
