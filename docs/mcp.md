# MCP sunucusu

`architect-studio` bir [Model Context Protocol](https://modelcontextprotocol.io) sunucusu
olarak çalışır. Freebuff, OpenCode, Cursor ve Claude Code gibi MCP istemcileri aynı dört
aracı stdio üzerinden çağırabilir.

## Başlatma

```bash
pnpm mcp
# veya doğrudan:
node --import tsx packages/mcp/src/index.ts
```

Sunucu stdout'u yalnızca JSON-RPC için kullanır; tanılama mesajları stderr'e gider.

## İstemci yapılandırması

Çoğu istemci aynı stdio tanımını kabul eder (yolu kendi klonunla değiştir):

```json
{
  "mcpServers": {
    "architect-studio": {
      "command": "node",
      "args": ["--import", "tsx", "/path/to/architect-studio/packages/mcp/src/index.ts"],
      "cwd": "/path/to/architect-studio"
    }
  }
}
```

- **Claude Code:** `claude mcp add architect-studio -- node --import tsx /path/to/packages/mcp/src/index.ts`
  veya proje kökünde `.mcp.json`.
- **Cursor:** `.cursor/mcp.json` içine yukarıdaki `mcpServers` bloğu.
- **OpenCode:** `opencode.json` içinde `mcp.architect-studio` altında `type: "local"` ve
  `command: ["node", "--import", "tsx", "packages/mcp/src/index.ts"]`.
- **Freebuff:** MCP sunucuları ekranından aynı komut ve argümanlarla ekle.

## Araçlar

### `architect_generate`

Fikirden veya mevcut `ArchState`'ten tam paket üretir, doğrular ve ZIP'i diske yazar.

| Alan | Tip | Açıklama |
|---|---|---|
| `idea` | string? | Doğal dilde mimari fikri |
| `state` | object? | Mevcut ArchState JSON'u |
| `demo` | boolean? | LLM yerine deterministik üretici |
| `locale` | string? | `en`, `tr`, `de`, `es`, `fr`, `pt`, `ja`, `zh` |
| `apiKey`, `baseUrl`, `model` | string? | BYOK; anahtar diske yazılmaz |
| `webSearch` | boolean? | Üretimden önce güncel referansları ara |
| `packageManager` | enum? | `pnpm`, `npm`, `yarn`, `bun` |
| `testRunner` | enum? | `vitest`, `jest`, `node` |
| `outputPath` | string? | ZIP yolu (varsayılan `out/agent-package.zip`) |

Dönen içerik: `outputPath`, `sizeBytes`, `validation`, `summary`, `tasks`, `artifacts`.

### `architect_preview`

Aynı girdileri kabul eder (ZIP yazmaz). State, Mermaid diyagramı, görevler, metrikler,
doğrulama ve artifact listesini döner. `includeFiles: true` tüm dosya içeriklerini ekler.

### `architect_validate`

- `files`: `{ "ARCHITECTURE.md": "...", ... }` verildiğinde deterministik doğrulayıcıyı çalıştırır.
- `state`: verildiğinde tam paketi üretip doğrular ve metrikleri döner.

### `architect_reverse_engineer`

`path` altındaki repoyu analiz eder; `package.json`, workspace paketleri, Prisma şeması,
`docker-compose` ve ADR'lerden `ArchState` çıkarır. `maxFiles`/`maxDepth` ile tarama
sınırlandırılabilir. Dönen içerik: `state`, `findings`, `warnings`, `summary`.

## Güvenlik notları

- `apiKey` yalnızca istek süresince kullanılır; loglanmaz ve pakete girmez.
- `architect_reverse_engineer` dosya içeriklerini döndürmez, yalnızca yapısal state üretir.
- Araçlar yerel süreçte çalışır; sandbox doğrulaması ayrı bir CLI/HTTP adımıdır.
