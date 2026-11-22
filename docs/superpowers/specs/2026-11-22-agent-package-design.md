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
