# Architect Studio — Frontend Spesifikasyonu

Bu doküman, mevcut backend'e (değiştirilmeden) bağlanacak yeni web arayüzünün
sözleşmesidir. Backend kodu bu doküman hazırlanırken **değiştirilmemiştir**;
arayüz, aşağıdaki dosya yollarına yazılmalıdır çünkü `packages/app/src/server.ts`
statik dosyaları sabit yollardan sunar:

| Yol | Sunucudaki karşılığı |
| --- | --- |
| `web/index.html` | `GET /`, `GET /index.html` |
| `web/app.js` | `GET /app.js` |
| `web/styles.css` | `GET /styles.css` |
| `node_modules/mermaid/dist/mermaid.min.js` | `GET /vendor/mermaid.min.js` (sunucu doğrudan servis eder) |

> Not: `web/` klasörü bu görev kapsamında silinmiştir. Yeni arayüz bu üç dosyayı
> yeniden oluşturduğunda `GET /` doğrudan `web/index.html` dosyasını sunar. Dosyalar
> yokken `/` isteği `500` dönmez: `200` + `application/json` ile `api-only` modunda
> bir karşılama yanıtı verir (ad, sürüm, `FRONTEND_SPEC.md` referansı ve aktif
> `/api/*` uç listesi); diğer tüm API uçları çalışmaya devam eder.

---

## 1. Proje Özeti

### Amaç
**Architect Studio**, doğal dilde anlatılan bir ürün fikrini (veya mevcut bir
depoyu) alıp; bileşen grafiği, veri modeli (entity + field), mimari kararlar
(ADR), paralel yürütülebilir görev paketleri, doğrulama metrikleri ve indirilebilir
bir ajan paketi (ZIP) üreten bir mimar asistanıdır.

Arayüzün işi, bu üretim hattını görünür ve denetlenebilir kılmaktır: kullanıcı
mimariyi görür, sohbetle değiştirir, sonucu doğrular ve paketler.

### Hedef kitle
- **Baş mimarlar / tech lead'ler** — fikri hızla teknik plana çevirenler.
- **Platform & DevOps ekipleri** — mevcut depoyu (reverse engineering) envantere
  alıp standardize edenler.
- **AI ajanı ile çalışan geliştiriciler** — paketi MCP/CLI üzerinden tüketenler.
- **Ürün sahipleri** — teknik olmayan dille fikri tarif edip çıktıyı görenler.

### Temel akışlar
1. **Fikirden mimariye (Preview)**
   Fikir yazılır → `POST /api/preview` → diyagram, entity'ler, görevler,
   metrikler, doğrulama ve üretilen dosya listesi gösterilir. Hiçbir şey diske
   yazılmaz.
2. **Sohbetle düzenleme (Chat)**
   Mevcut state + doğal dil talimatı → `POST /api/chat` → güncellenmiş state ve
   yapılan değişikliklerin listesi. Deterministik mod (`demo: true`) anahtar
   gerektirmez; BYOK modunda LLM devreye girer, başarısız olursa deterministik
   ayrıştırıcıya düşer.
3. **Paket üretimi (Generate)**
   Aynı gövde → `POST /api/generate` → `application/zip` indirilir; özet bilgi
   yanıt başlıklarında (`X-Validation`, `X-Task-Count`, …) döner.
4. **Tersine mühendislik (Reverse)**
   Yerel depo yolu → `POST /api/reverse` → tarama özeti, tespit edilen bileşenler,
   entity'ler, kararlar ve (istenirse) REA artifact bulguları.
5. **Kum havuzunda doğrulama (Sandbox)**
   Üretilen paket `POST /api/sandbox` ile izole bir sürücüde (bwrap, podman,
   docker, firejail, systemd-run, temp-dir) çalıştırılır; çıkış kodu ve stdout
   raporlanır.

---

## 2. Sayfa ve Ekranlar

Arayüz **tek sayfa (SPA) bir "Studio" kabuğu**dur. Yönlendirme (router) gerekmez;
bölümler sekmeler/paneller olarak açılır ve URL hash'i (`#preview`, `#tasks`,
`#reverse`, `#settings`) ile derin bağlantı verilebilir.

### 2.1 Ekran listesi

| # | Ekran / Bölge | Amaç |
| --- | --- | --- |
| E1 | **Uygulama Kabuğu (App Shell)** | Üst bar, sol ray (navigasyon), ana içerik, bildirim katmanı |
| E2 | **Fikir Girişi (Composer)** | Fikri yazma, dil/üretim modu seçimi, örnek fikirler |
| E3 | **Mimari Tuvali (Architecture)** | Mermaid diyagramı + bileşen/entity özeti |
| E4 | **Sohbet Paneli (Chat)** | Doğal dil ile mimari düzenleme, değişiklik geçmişi |
| E5 | **Görev Panosu (Task Board)** | Dalga (wave) bazlı paralel görev listesi ve token sayıları |
| E6 | **Kalite Paneli (Metrics & Validation)** | Metrikler, doğrulama sorunları, kapsam |
| E7 | **Artifact Gezgini** | Üretilen/her zamanlanan dosyaların listesi ve önizlemesi |
| E8 | **Reverse Engineering Paneli** | Yol girişi, REA anahtarı, tarama sonuçları |
| E9 | **Kum Havuzu Paneli** | Sürücü tespiti, doğrulama çalıştırması, çıktı konsolu |
| E10 | **Ayarlar (BYOK)** | API anahtarı, base URL, model, paket yöneticisi, test koşucusu |
| E11 | **Sistem Durumu** | Sürüm, tokenizer, diller, REA tespiti, sağlık |

### 2.2 UI bileşenleri ve etkileşimler

| Bileşen | Davranış | Bağlı API |
| --- | --- | --- |
| `AppHeader` | Ürün adı, sürüm rozeti, dil seçici, tema anahtarı, "Paketi indir" birincil aksiyonu | `GET /api/version` |
| `LocaleSelect` | 8 dil: tr, en, de, es, fr, pt, ja, zh. Seçim `Accept-Language` yerine gövdede `locale` olarak gönderilir; arayüz metinleri `GET /api/i18n` kataloğundan gelir | `GET /api/i18n?locale=` |
| `IdeaComposer` | Çok satırlı metin, `demo` anahtarı, örnek fikir çipleri, `Ctrl/⌘+Enter` ile gönderim | `POST /api/preview` |
| `ModeToggle` | `Demo` (anahtarsız, deterministik) ↔ `BYOK` (LLM) | — |
| `ArchitectureCanvas` | Mermaid `flowchart` çıktısını `mermaid.render` ile basar. Düğüm tıklaması sağ panelde bileşen detayını açar. Zoom/pan (100–200 %), "SVG kopyala" | `diagram` alanı |
| `EntityTable` | Entity adı, servis, veritabanı, alanlar (ad, tip, zorunlu/tekil/birincil rozetleri) | `state.entities` |
| `ChatPanel` | Mesaj listesi (kullanıcı/asistan), değişiklik rozetleri (`node/edge/entity/field`, `added/removed/updated`), "geri al" (son state'i tekrar gönder) | `POST /api/chat` |
| `TaskBoard` | Wave kolonları; her kartta başlık, bağımlılıklar, dosyalar, token sayısı. Filtre: entity / wave | `tasks[]` |
| `MetricsGrid` | Her metrik için ad, değer, hedef, geçti/kaldı durumu | `metrics[]` |
| `ValidationPanel` | `ok`, `passRate`, `checksRun`, `unresolvedRefs`, `deterministicCoverage`, sorun listesi (dosya + mesaj) | `validation` |
| `ArtifactExplorer` | Dosya ağacı + seçili dosyanın içeriği (monospace, kopyala). İndirme yalnızca ZIP ile | `files`, `artifacts[]` |
| `ReverseForm` | Yerel yol, `useRea` anahtarı, `maxFiles`, `maxDepth`; sonuçta özet, bulgular, uyarılar, REA motoru | `POST /api/reverse`, `GET /api/rea` |
| `SandboxPanel` | Sürücü listesi (available/version/isolation), "Doğrula" butonu, stdout/stderr konsolu, çıkış kodu | `GET /api/sandboxes`, `POST /api/sandbox` |
| `SettingsDrawer` | `apiKey` (yalnızca bellekte), `baseUrl`, `model`, `packageManager` (pnpm/npm/yarn/bun), `testRunner` (vitest/jest/node) | — |
| `ToastHost` | `aria-live="polite"` bölgesi; başarı/hata/uyarı bildirimleri, 5 sn sonra kapanır | — |
| `ConfirmDialog` | Yıkıcı aksiyon yok; yalnızca anahtar temizleme/yeniden üretim onayı | — |

### 2.3 Etkileşim kuralları
- **Tek uçuş kuralı:** Aynı anda yalnızca bir üretim isteği (`preview`/`chat`/
  `generate`) çalışır; ikinci istek butonu devre dışı bırakır.
- **State kaynağı:** Sunucu her yanıtında tam `state` döner; istemci kendi
  mimari modelini üretmez, yalnızca son `state`'i saklar ve bir sonraki istekte
  gönderir.
- **Anahtar güvenliği:** `apiKey` hiçbir zaman `localStorage`/`sessionStorage`/
  çerez veya URL'e yazılmaz; yalnızca bellek içi değişkende tutulur ve her
  istekte gövdede gönderilir. Sayfa yenilenince silinir.
- **Klavye:** `g` `p` → preview, `g` `r` → reverse, `?` → kısayol yardımı.
- **Erişilebilirlik:** Tüm kontroller klavye ile erişilebilir, görünür odak
  halkası, `aria-busy` ile yüklenme durumu, diyagram için `alt` metin karşılığı
  (`aria-label` ile özet).

---

## 3. Tasarım / UI-UX

### 3.1 Tasarım dili
"Blueprint" metaforu: koyu lacivert zemin, ince ızgara dokusu, camgöbeği vurgu,
monospace teknik detaylar. Süs değil, okunabilirlik önceliklidir.

### 3.2 Renk paleti (HEX)

**Koyu tema (varsayılan)**

| Token | HEX | Kullanım |
| --- | --- | --- |
| `--bg-canvas` | `#0A0E14` | Sayfa zemini |
| `--bg-surface` | `#111823` | Kart/panel zemini |
| `--bg-elevated` | `#16202D` | Modal, açılır menü, kod bloğu |
| `--border-subtle` | `#223044` | Ayırıcı, kart kenarı |
| `--border-strong` | `#2F4359` | Girdi kenarı, odak dışı vurgu |
| `--text-primary` | `#E6EDF5` | Gövde metni |
| `--text-secondary` | `#9FB0C3` | Etiket, yardımcı metin |
| `--text-muted` | `#6B7F96` | Placeholder, devre dışı |
| `--accent` | `#4CC2FF` | Birincil aksiyon, bağlantı, odak |
| `--accent-hover` | `#7AD2FF` | Hover |
| `--accent-contrast` | `#04121C` | Vurgu üzerindeki metin |
| `--success` | `#3DDC97` | Geçen metrik, doğrulama OK |
| `--warning` | `#FFB454` | Uyarı, uyarı notu |
| `--danger` | `#FF6B6B` | Hata, kalan metrik |
| `--info` | `#8F9BFF` | Bilgi, REA bulgusu |

**Açık tema**

| Token | HEX |
| --- | --- |
| `--bg-canvas` | `#F7F9FC` |
| `--bg-surface` | `#FFFFFF` |
| `--bg-elevated` | `#EEF3F9` |
| `--border-subtle` | `#DCE5EF` |
| `--border-strong` | `#B9C7D8` |
| `--text-primary` | `#0F1720` |
| `--text-secondary` | `#46586D` |
| `--text-muted` | `#7A8CA3` |
| `--accent` | `#0A7CC4` |
| `--accent-hover` | `#0968A6` |
| `--accent-contrast` | `#FFFFFF` |
| `--success` | `#12805C` |
| `--warning` | `#B26B00` |
| `--danger` | `#C22B2B` |
| `--info` | `#4A56C8` |

**Diyagram düğüm renkleri (her iki tema)**

| Bileşen türü | HEX |
| --- | --- |
| `service` | `#4CC2FF` |
| `database` | `#3DDC97` |
| `queue` | `#FFB454` |
| `external` | `#8F9BFF` |
| `ui` | `#FF7AC6` |

Metin kontrastı WCAG AA (≥ 4.5:1) olacak şekilde seçilmiştir; `--text-muted`
yalnızca 14 px ve üzeri yardımcı metinde kullanılır.

### 3.3 Tipografi
- **Gövde / arayüz:** sistem yığını — `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
- **Teknik metin (kod, ID, token, yol):** `ui-monospace, SFMono-Regular, "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace`.
- **Ölçek (px / satır yüksekliği):** 12/16, 13/20, 14/22, 16/24, 20/28, 24/32, 32/40, 40/48.
- **Ağırlıklar:** 400 gövde, 500 etiket/buton, 600 başlık, 700 yalnızca sayısal KPI.
- Harici font servisi **kullanılmaz**; sunucunun CSP'si yalnızca `'self'`
  kaynaklarına izin verir.

### 3.4 Tema
- `html[data-theme="dark"|"light"]` ile yönetilir; ilk yüklemede
  `prefers-color-scheme` okunur, kullanıcı seçimi `localStorage`'da saklanır
  (`architect.theme`). Tema anahtarı üst bardadır.
- Renk geçişi 120 ms; `prefers-reduced-motion: reduce` durumunda geçiş yok.

### 3.5 Layout
- **Izgara:** 12 kolon, 24 px oluk, maksimum içerik genişliği 1440 px.
- **Kabuk:** üst bar 64 px sabit; sol ray 280 px (daraltılabilir 72 px);
  içerik `calc(100vh - 64px)` yüksekliğinde, kendi içinde kaydırılır.
- **Bölme:** Mimari tuvali %60 / sohbet paneli %40 (≥ 1280 px); altında tek
  kolona iner.
- **Kart:** 12 px yarıçap, 1 px `--border-subtle`, 16–20 px iç boşluk, gölge yok
  (koyu temada `0 1px 0 rgba(255,255,255,0.04)` üst çizgi).
- **Odak halkası:** `outline: 2px solid var(--accent); outline-offset: 2px`.

### 3.6 Duyarlı davranış (responsive)

| Kırılım | Genişlik | Davranış |
| --- | --- | --- |
| `sm` | < 640 px | Tek kolon; sol ray alt sekmeye dönüşür; diyagram yatay kaydırılır; tablolar kart listesine iner |
| `md` | 640–1023 px | İki kolon; sohbet altta tam genişlik |
| `lg` | 1024–1439 px | Ray + içerik; tuval/sohbet %55/%45 |
| `xl` | ≥ 1440 px | Tam yerleşim, üçüncü detay paneli açılır |

Dokunma hedefleri en az 44×44 px; tablo satırları mobilde 56 px.

---

## 4. API Sözleşmesi

### 4.1 Genel kurallar
- **Temel URL:** arayüzü sunan origin (geliştirmede `http://localhost:3000`).
- **İçerik türü:** istekler `Content-Type: application/json`; yanıtlar
  `application/json; charset=utf-8` (ZIP hariç `application/zip`).
- **Kimlik doğrulama:** **Yok.** JWT, oturum çerezi veya API token yoktur.
  LLM anahtarı yalnızca istek gövdesinde (`apiKey`) taşınır, sunucuda saklanmaz.
- **Dil:** `locale` gövde alanı ya da `Accept-Language` başlığı
  (`tr, en, de, es, fr, pt, ja, zh`; varsayılan `en`).
- **Gövde limiti:** 256 KiB. Aşımda `413`.
- **Hız limiti:** IP başına dakikada `RATE_LIMIT_PER_MIN` (varsayılan 120).
  Aşımda `429` + `Retry-After` (saniye).
- **Güvenlik başlıkları (tüm yanıtlar):** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`.
- **JSON yanıtları:** `Cache-Control: no-store`.

### 4.2 Uç noktalar

#### `GET /`
Arayüz dosyaları yokken (`web/index.html` bulunmuyorken) dönen karşılama yanıtı:
```json
{
  "name": "architect-studio",
  "version": "2.1.0",
  "mode": "api-only",
  "spec": "FRONTEND_SPEC.md",
  "endpoints": ["GET /api/health", "GET /api/version", "POST /api/generate"]
}
```
`endpoints` listesi `packages/app/src/contract.ts` içindeki `ENDPOINTS` ile aynıdır.

#### `GET /api/health`
```json
{ "ok": true, "version": "2.1.0" }
```

#### `GET /api/version`
```json
{
  "name": "architect-studio",
  "version": "2.1.0",
  "tokenizer": "gpt-tokenizer",
  "locales": [
    { "id": "tr", "label": "Türkçe" },
    { "id": "en", "label": "English" },
    { "id": "de", "label": "Deutsch" },
    { "id": "es", "label": "Español" },
    { "id": "fr", "label": "Français" },
    { "id": "pt", "label": "Português" },
    { "id": "ja", "label": "日本語" },
    { "id": "zh", "label": "中文" }
  ]
}
```

#### `GET /api/i18n?locale=de`
```json
{
  "locale": "de",
  "defaultLocale": "en",
  "locales": [
    { "id": "tr", "label": "Türkçe" },
    { "id": "en", "label": "English" },
    { "id": "de", "label": "Deutsch" },
    { "id": "es", "label": "Español" },
    { "id": "fr", "label": "Français" },
    { "id": "pt", "label": "Português" },
    { "id": "ja", "label": "日本語" },
    { "id": "zh", "label": "中文" }
  ],
  "messages": {
    "ui.preview": "Zuerst ansehen",
    "ui.generate": "Paket erstellen",
    "error.invalidIdea": "Die Idee muss mindestens 3 Zeichen lang sein.",
    "…": "…"
  }
}
```

#### `GET /api/sandboxes`
```json
{
  "sandboxes": [
    { "id": "bwrap", "available": false, "isolation": "namespace", "version": null },
    { "id": "podman", "available": false, "isolation": "container", "version": null },
    { "id": "docker", "available": false, "isolation": "container", "version": null },
    { "id": "firejail", "available": false, "isolation": "namespace", "version": null },
    { "id": "systemd-run", "available": false, "isolation": "service", "version": null },
    { "id": "temp-dir", "available": true, "isolation": "process", "version": null }
  ]
}
```

#### `GET /api/rea`
```json
{
  "detection": {
    "available": true,
    "engine": "rea",
    "binary": "/path/to/node_modules/.bin/rea",
    "version": "rea@6.10.1",
    "modes": ["analyze-javascript-application", "analyze", "inspect"],
    "reason": null
  }
}
```
> `available: false` iken `engine: "static"` ve `reason` dolu gelir; arayüz
> "yerleşik analizör kullanılacak" bilgisini gösterir.

#### `POST /api/preview` ve `POST /api/generate`
**İstek** (iki uç aynı gövdeyi kabul eder; `idea` **veya** `state` zorunlu):
```json
{
  "idea": "online store with orders, users and products",
  "locale": "tr",
  "demo": true,
  "apiKey": "sk-…",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "webSearch": false,
  "searchProvider": "auto",
  "searchApiKey": "…",
  "sandbox": "auto"
}
```
`state` verilirse mevcut mimariden üretim yapılır:
```json
{ "state": { "version": 1, "nodes": [], "edges": [], "decisions": [], "entities": [] } }
```

**`/api/preview` yanıtı — `200`:**
```json
{
  "locale": "tr",
  "state": {
    "version": 1,
    "nodes": [
      { "id": "api-svc", "kind": "service", "name": "Store API", "props": { "tech": "http" } },
      { "id": "primary-database", "kind": "database", "name": "Primary Database", "props": { "engine": "postgres" } }
    ],
    "edges": [{ "id": "edge-api-svc-primary-database", "from": "api-svc", "to": "primary-database", "protocol": "sql" }],
    "decisions": [
      {
        "id": "adr-001",
        "title": "Use PostgreSQL as the primary datastore",
        "context": "Detected from the existing repository's dependencies.",
        "decision": "Keep PostgreSQL as the system of record.",
        "alternatives": []
      }
    ],
    "entities": [
      {
        "id": "ent-order",
        "name": "Order",
        "description": "",
        "serviceId": "api-svc",
        "databaseId": "primary-database",
        "fields": [
          { "name": "id", "type": "uuid", "required": true, "unique": false, "primary": true },
          { "name": "total", "type": "decimal", "required": true, "unique": false, "primary": false }
        ],
        "relations": []
      }
    ]
  },
  "diagram": "flowchart LR\n  api-svc[\"Store API\"]\n  …",
  "files": { "ARCHITECTURE.md": "# Mimari\n…", "openapi.yaml": "openapi: 3.0.3\n…", "tasks/T-001.md": "# T-001\n…" },
  "summary": {
    "nodes": 2, "edges": 1, "entities": 1, "decisions": 1,
    "tasks": 2, "waves": 1, "tokenizer": "gpt-tokenizer"
  },
  "tasks": [
    {
      "id": "T-001",
      "title": "Implement Order domain and persistence",
      "dependsOn": [],
      "wave": "wave-0",
      "files": ["src/domain/order.ts"],
      "tokens": 1840,
      "entities": ["Order"]
    }
  ],
  "metrics": [
    { "name": "entity_coverage", "value": 1, "target": 1, "pass": true },
    { "name": "unresolved_relations", "value": 0, "target": 0, "pass": true }
  ],
  "validation": {
    "ok": true,
    "passRate": 1,
    "unresolvedRefs": 0,
    "deterministicCoverage": 1,
    "checksRun": 24,
    "issues": []
  },
  "artifacts": ["ARCHITECTURE.md", "TASKS.md", "openapi.yaml", "tasks/T-001.md"],
  "sandbox": {
    "requested": "auto",
    "resolved": "temp-dir",
    "fallback": true,
    "drivers": [{ "id": "temp-dir", "available": true, "isolation": "process", "version": null }]
  }
}
```
> `sandbox` yalnızca istekte `sandbox` alanı verildiyse döner.

**`/api/generate` yanıtı — `200`** (gövde ikili ZIP):
```
Content-Type: application/zip
Content-Disposition: attachment; filename="agent-package.zip"
Cache-Control: no-store
X-Metrics-Passed: 15/16
X-Task-Count: 4
X-Package-SHA256: 6d687003c7ef97393ab380b1ebd95b3baa7fed7df89d28ef6e61db15780f7cb1
X-Validation: ok
X-Entities: 3
X-Tokenizer: gpt-tokenizer
X-Locale: tr
```
Arayüz bu başlıkları indirme sonrası "özet" olarak gösterir; gövdeyi `Blob` +
`URL.createObjectURL` ile indirir. `X-Package-SHA256` gövdenin bayt-bayt SHA-256'sıdır;
`REPRODUCIBLE=1` (veya `--reproducible`) ile aynı girdi aynı hash'i üretir.

#### `POST /api/chat`
**İstek:**
```json
{
  "state": { "version": 1, "nodes": [], "edges": [], "decisions": [], "entities": [] },
  "message": "Order'a priorityCount int ekle",
  "locale": "tr",
  "demo": true,
  "apiKey": "sk-…",
  "baseUrl": "https://api.openai.com/v1",
  "model": "gpt-4o-mini",
  "packageManager": "pnpm",
  "testRunner": "vitest"
}
```
**Yanıt — `200`:** `/api/preview` gövdesi + `chat` zarfı:
```json
{
  "locale": "tr",
  "state": { "…": "güncellenmiş ArchState" },
  "diagram": "flowchart LR\n…",
  "files": { "…": "…" },
  "summary": { "…": "…" },
  "tasks": [],
  "metrics": [],
  "validation": { "ok": true, "passRate": 1, "unresolvedRefs": 0, "deterministicCoverage": 1, "checksRun": 24, "issues": [] },
  "artifacts": ["ARCHITECTURE.md"],
  "chat": {
    "reply": "1 değişiklik uygulandı: Order.priorityCount.",
    "changes": [
      { "type": "field", "action": "added", "target": "Order.priorityCount", "detail": "int field added" }
    ],
    "source": "deterministic",
    "intent": "add-field",
    "notes": []
  }
}
```
`intent` değerleri: `add-cache`, `add-database`, `add-queue`, `add-external`,
`add-ui`, `add-field`, `remove-field`, `remove-component`, `split-services`,
`describe`, `unknown`.
`source` değerleri: `deterministic`, `llm` (LLM başarısız olursa `notes`
içinde `"LLM unavailable, used the deterministic parser: …"` döner).

#### `POST /api/reverse`
**İstek:**
```json
{ "path": "/home/user/projects/storefront", "useRea": true, "maxFiles": 2500, "maxDepth": 8 }
```
**Yanıt — `200`:**
```json
{
  "summary": "2 files scanned · 1 service, 1 ui · 0 entities · 3 decisions · REA rea (4 findings, 1 artifacts)",
  "root": "/home/user/projects/storefront",
  "state": { "version": 1, "nodes": [], "edges": [], "decisions": [], "entities": [] },
  "findings": [{ "kind": "service", "source": "package.json", "detail": "express → API Service" }],
  "warnings": ["REA limitation: Graph coverage is incomplete; …"],
  "scannedFiles": 2,
  "cacheHit": false,
  "rea": {
    "engine": "rea",
    "detection": { "available": true, "engine": "rea", "binary": "/path/.bin/rea", "version": "rea@6.10.1", "modes": [], "reason": null },
    "scannedArtifacts": 1,
    "warnings": [],
    "findings": [
      {
        "id": "rea-architecture-1",
        "category": "architecture",
        "title": "Reconstructed JavaScript modules",
        "detail": "REA reconstructed 6 module reference(s), 1 parsed file(s), 69232 AST node(s) from the application.",
        "confidence": 0.8,
        "evidence": [{ "source": "rea", "snippet": "src/main.js" }]
      }
    ]
  }
}
```

`cacheHit: true` ise yanıt içerik-hash önbelleğinden geldi; `cache: false` göndererek
önbellek atlanır. Alan her yanıtta bulunur.

#### `POST /api/reverse/jobs` ve `GET /api/reverse/jobs/{id}/events`

Uzun süren analiz için iş (job) akışı; istek gövdesi `/api/reverse` ile aynıdır.

**Yanıt — `202`:**
```json
{ "jobId": "0f0c…", "status": "/api/reverse/jobs/0f0c…", "events": "/api/reverse/jobs/0f0c…/events" }
```

- `GET /api/reverse/jobs/{id}` → `{ jobId, state: "running"|"done"|"error", createdAt, events: [...] }`
- `GET /api/reverse/jobs/{id}/events` → `text/event-stream`; her olay `data:` satırında JSON:

```json
{ "seq": 1, "type": "scan", "at": "2026-11-24T19:00:00.000Z" }
```

`type` sırası: `scan` → `rea` (yalnızca `useRea`) → `merge` → `validate` → `done` | `error`.
`done` olayının `payload` alanı `/api/reverse` yanıtının tamamıdır; `error` olayının payload'ı
`{ "code": "reverse_timeout" | "reverse_busy" | "reverse_failed", "message": "…" }` içerir.
`seq` artımlıdır, böylece yeniden bağlanan istemci gördüğü `seq`'ten sonrasını uygular. Biten işe
sonradan bağlanan istemci tüm geçmişi alır ve akış kapanır; işler 5 dakika saklanır.

#### `POST /api/sandbox`
**İstek:**
```json
{ "idea": "postgres orders api", "demo": true, "sandbox": "temp-dir", "fallback": true, "locale": "tr" }
```
`state` alternatifi ve tüm üretim seçenekleri kabul edilir.
**Yanıt — `200`:**
```json
{
  "driver": "temp-dir",
  "isolation": "process",
  "exitCode": 0,
  "stdout": "package ok",
  "stderr": "",
  "timedOut": false,
  "durationMs": 812,
  "validation": { "ok": true, "passRate": 1, "unresolvedRefs": 0, "deterministicCoverage": 1, "checksRun": 24, "issues": [] }
}
```

#### Statik rotalar
`GET /`, `GET /index.html` → `web/index.html` (`text/html`, `no-store`, CSP).
`GET /app.js` → `web/app.js` (`application/javascript`, `no-store`).
`GET /styles.css` → `web/styles.css` (`text/css`, `no-store`).
`GET /vendor/mermaid.min.js` → `application/javascript`, `Cache-Control: public, max-age=86400`.

CSP (yalnızca `/` için):
```
default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:
```
> Bu nedenle CDN, harici font, harici analytics/polyfill **yüklenemez**;
> `window.mermaid` `/vendor/mermaid.min.js` adresinden gelir.

### 4.3 Hata gövdesi
Tüm hatalar aynı zarfta döner:
```json
{ "error": "Kullanıcıya gösterilebilir mesaj", "code": "makine_kodu", "details": { "…": "opsiyonel" } }
```
`details` yalnızca `sandbox_unavailable` hatasında dolu gelir.

---

## 5. Hata ve Yüklenme Durumları

### 5.1 Hata kodları → durum → arayüz davranışı

| HTTP | `code` | Anlam | Arayüz davranışı |
| --- | --- | --- | --- |
| 400 | `invalid_idea` | Fikir 3 karakterden kısa | Composer altında inline hata, toast yok |
| 400 | `invalid_state` | ArchState şeması geçersiz | Kalıcı alert + "mimariyi sıfırla" butonu |
| 400 | `empty_message` | Boş sohbet mesajı | Girdi kenarı kırmızı, toast yok |
| 400 | `invalid_json` | Gövde JSON değil | Toast: "İstek biçimi hatalı" |
| 400 | `invalid_path` | Reverse yolu yok/dizin değil | Yol alanı altında hata; son örnek yollar önerilir |
| 400 | `path_not_allowed` | Yol `REVERSE_ROOTS` dışında (symlink/`..` dahil) | Yol alanında hata + "sunucuda izinli kökler" ipucu; çözümlenmiş yol gösterilmez |
| 403 | `reverse_disabled` | Sunucu ağa açık ama `REVERSE_ROOTS` tanımsız | Kalıcı alert: "Sunucuda reverse için izinli kök yok"; ayar düzeltilmeden tekrar denenmez |
| 429 | `reverse_busy` | Eşzamanlı reverse kotası dolu | Toast + `Retry-After` sonrası "tekrar dene" önerisi; form girdisi korunur |
| 504 | `reverse_timeout` | Reverse işi süre bütçesini aştı | Kalıcı alert: `maxDepth`/`maxFiles` küçültme önerisi |
| 400 | `invalid_sandbox` | Desteklenmeyen kum havuzu | Seçici varsayılana döner + toast |
| 400 | `sandbox_failed` | Doğrulama süreci başarısız | Kum havuzu konsolunda stderr; toast `error` |
| 400 | `sandbox_unavailable` | Hiçbir sürücü çalışmadı | Modal: sürücü listesi + `details`; "temp-dir ile dene" |
| 400 | `invalid_package_manager` / `invalid_test_runner` | Geçersiz seçenek | Seçici geçerli değere döner |
| 400 | `unsupported_runtime` | Desteklenmeyen çalışma zamanı | Alert + desteklenenler listesi |
| 404 | `not_found` | Bilinmeyen uç nokta | Toast (genelde istemci hatası) |
| 413 | `payload_too_large` | > 256 KiB | Alert: "İstek çok büyük (limit 256 KiB)" |
| 429 | `rate_limited` | Dakikalık limiter | Geri sayımlı toast (`Retry-After` saniye); butonlar kilitli |
| 500 | `internal_error` | Beklenmeyen hata | Kalıcı alert + "tekrar dene"; `detail` (üretimde yok) katlanır |
| 502 | `llm_failed` | LLM sağlayıcı hatası | Toast `warning` + "demo moduna geç" önerisi; sohbet geçmişi korunur |

**Yerel ağ hatası** (`fetch` reddi): "Sunucuya ulaşılamadı — bağlantını kontrol et"
alarımı; istek gövdesi korunur, "tekrar dene" aynı gövdeyle yeniden gönderir.
**Zaman aşımı:** İstemci 60 sn (`/api/reverse` ve `/api/sandbox` için 120 sn).
Aşımda istek iptal edilir (`AbortController`) ve toast gösterilir.

### 5.2 Toast / alert kuralları
- **Toast** (`aria-live="polite"`, sağ üst): kısa, geçici, tekrar denenebilir
  hatalar ve başarılar. Otomatik kapanma 5 sn; hover'da durur; maksimum 3 eşzamanlı.
- **Inline hata**: alan bazlı doğrulama (`invalid_idea`, `invalid_path`,
  `empty_message`).
- **Kalıcı alert** (içerik üstü, `role="alert"`): state bozulması, 500,
  `sandbox_unavailable`. Kapatılana kadar kalır.
- **Renk/ikon**: hata `--danger`, uyarı `--warning`, başarı `--success`;
  ikon + metin birlikte (yalnızca renkle anlatım yok).

### 5.3 Yüklenme durumları
| Durum | Görsel | Süre eşiği |
| --- | --- | --- |
| İlk yükleme | İskelet kabuk: üst bar + 3 kart silueti (`skeleton`, `animation: pulse 1.6s`) | hemen |
| Preview/Chat hesaplanıyor | Buton içinde `spinner` + "Mimari üretiliyor…" ; diyagram alanında iskelet | hemen |
| Diyagram render | Mermaid alanında `spinner` + `aria-busy="true"`; hata olursa `diagram` metni ham `<pre>` olarak gösterilir | hemen |
| ZIP indiriliyor | İndirme butonu `spinner` + "Paketleniyor…"; `Content-Length` varsa yüzde | hemen |
| Reverse taraması | Aşamalı metin: "Taranıyor → REA çalıştırılıyor → Birleştiriliyor"; iptal butonu | 300 ms sonra |
| Sandbox doğrulaması | Konsol üstünde `spinner` + "Doğrulanıyor…"; canlı stdout akışı yoksa 1 sn'de bir iskelet satır | hemen |
| Uzun işlem (> 10 sn) | Ek bilgi satırı: "Bu işlem 2 dakikaya kadar sürebilir" | 10 sn |

- İskeletler gerçek yerleşimi taklit eder (kart yüksekliği ve kolon sayısı aynı).
- Yükleme sırasında form alanları `disabled` + `aria-disabled`, ancak kopyalama
  ve iptal serbesttir.
- Boş durumlar: mimari yok → "Fikrini yaz, mimariyi üretelim" + 3 örnek çip;
  görev yok → "Bu mimari için görev üretilmedi"; artifact yok → "Henüz dosya yok".
- `prefers-reduced-motion` açıkken spinner yerine sabit ilerleme çubuğu kullanılır.

### 5.4 Doğrulama sonrası bilgilendirme
- `validation.ok === false` ise `ValidationPanel` otomatik açılır ve sorunlar
  dosya adına göre gruplanır.
- `metrics` içinde `pass: false` olanlar `MetricsGrid` başında listelenir
  (`X-Metrics-Passed` başlığı ile tutarlı olmalı).
- `X-Validation: failed` başlığı ZIP indirmesini **engellemez**; yalnızca uyarı
  bandı gösterilir.
