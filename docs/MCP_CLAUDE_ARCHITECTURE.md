# Lume Desktop — Model Context Protocol (MCP) & Claude Integration Architecture

Lume Desktop implements bidirectional **Model Context Protocol (MCP)** interoperability designed for **Claude Desktop**, **Claude Code**, and standard MCP clients/servers.

## 1. Bidirectional MCP Overview

| Role | Module | Transport / Standard | Purpose |
| :--- | :--- | :--- | :--- |
| **MCP Server** | [`integrations/mcp-server.cjs`](../integrations/mcp-server.cjs) | JSON-RPC 2.0 over `stdio` (`2024-11-05` to `2026-07-28`) | Receives explicit human-in-the-loop handoffs from Claude Desktop, Claude Code, Cursor, or Codex into Lume. |
| **MCP Client** | [`lib/connectors/mcp.cjs`](../lib/connectors/mcp.cjs) | `@modelcontextprotocol/client` v2.3.1 (`stdio`, `SSE`, `StreamableHTTP`) | Connects Lume assistants to external MCP tools with OAuth 2.0 PKCE loopback auth and pagination loop protection. |
| **Client Config Installer** | [`lib/connectors/client-install.cjs`](../lib/connectors/client-install.cjs) | Atomic JSON / TOML writer + SHA-256 drift check | Registers or removes Lume in Claude Desktop, Claude Code, Cursor, and Codex without overwriting user edits. |

## 2. Lume as an MCP Server for Claude Desktop & Claude Code

[`integrations/mcp-server.cjs`](../integrations/mcp-server.cjs) implements a standalone Node.js JSON-RPC 2.0 stdio MCP server (`serverInfo: { name: "lume", version: "0.2.0" }`) using `ELECTRON_RUN_AS_NODE=1`.

### Exposed MCP Tools (7 Tools)

1. `app_status` *(readOnlyHint)* — Verifies whether the local Lume executable is installed and reports supported handoff versions.
2. `list_assistants` *(readOnlyHint)* — Lists configured Lume assistants (`id`, `name`, metadata) from the local bridge manifest.
3. `prepare_session` — Stages a conversation, meeting, summary, code-review, study, or follow-up session with up to 8 attached text files (`128 KB` each, `2 MB` max payload).
4. `prepare_summary` — Prepares a structured context summary request inside Lume.
5. `prepare_code_review` — Sends source files to Lume for concrete issue review.
6. `prepare_followup` — Stages next-step follow-ups grounded in provided context.
7. `propose_assistant` — Drafts a custom assistant with separated conversation, insight, question, summary, and tool instructions for user review before saving.

**Human-in-the-Loop Guarantee:** Every write/staging tool writes a mode-`0600` JSON handoff file and opens `lume://session/start?handoff=<uuid>` with `reviewRequired: true`. Nothing is sent automatically without explicit user review inside Lume.

## 3. Atomic, SHA-256 Drift-Safe Client Registration

[`lib/connectors/client-install.cjs`](../lib/connectors/client-install.cjs) (`ClientInstaller`) automatically detects and updates native MCP client configuration files:

- **Claude Desktop:** `%APPDATA%\\Claude\\claude_desktop_config.json`
- **Claude Code:** `~/.claude.json`
- **Cursor:** `~/.cursor/mcp.json`
- **Codex:** `$CODEX_HOME/config.toml` or `~/.codex/config.toml`
- **Custom JSON MCP Clients:** User-selected JSON file with `mcpServers`

Before mutating any config file, `ClientInstaller` computes a **SHA-256** hash of the managed entry and stores an encrypted backup in the profile vault. If the user manually edits the `lume` entry later, both re-installation and uninstallation halt safely to prevent overwriting manual changes.

### Example Configuration Generated for Claude Desktop & Claude Code

```json
{
  "mcpServers": {
    "lume": {
      "command": "C:\\Path\\To\\Lume.exe",
      "args": ["C:\\Path\\To\\resources\\integrations\\mcp-server.cjs"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1",
        "LUME_DATA_DIR": "%APPDATA%\\Lume"
      }
    }
  }
}
```

## 4. Lume as an MCP Client (`@modelcontextprotocol/client` v2.3.1)

[`lib/connectors/mcp.cjs`](../lib/connectors/mcp.cjs) (`MCPConnector`) supports:

- **Transports:** `StdioClientTransport` (with `ELECTRON_RUN_AS_NODE=1` support and `stderr` secret isolation), `SSEClientTransport`, and `StreamableHTTPClientTransport`.
- **OAuth 2.0 PKCE Loopback:** Dynamic client registration/discovery state persistence, `authorization_code` + `refresh_token` grant flow, and token invalidation scopes stored in Windows `safeStorage`.
- **Resilience:** Repeated-cursor detection during `tools/list` pagination (capped at 500 tools) and per-call AbortSignal timeouts (`30s` handshake/list, `90s` tool execution).
