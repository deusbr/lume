# Lume Desktop 0.2.0 — Open-Source Local AI & Model Context Protocol (MCP) Desktop Assistant

[![CI](https://github.com/deusbr/lume/actions/workflows/ci.yml/badge.svg)](https://github.com/deusbr/lume/actions/workflows/ci.yml)
[![Release](https://github.com/deusbr/lume/actions/workflows/release.yml/badge.svg)](https://github.com/deusbr/lume/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)


**Lume Desktop** is an MIT-licensed, privacy-first Windows x64 AI desktop assistant built with **Electron** and **Node.js 24**. It implements **bidirectional Model Context Protocol (MCP)** interoperability — serving 7 human-in-the-loop tools directly to **Claude Desktop** and **Claude Code** while connecting assistants to external MCP servers (`@modelcontextprotocol/client` v2.3.1), local **llama.cpp** (CPU/Vulkan GGUF) inference, persistent CPU **Whisper** transcription, per-profile **SQLite** memory, and cryptographically verified updates.

## Overview & Architecture

- **Native MCP Server for Claude Desktop & Claude Code:** Standalone stdio JSON-RPC 2.0 server ([`integrations/mcp-server.cjs`](integrations/mcp-server.cjs)) exposing 7 human-reviewed tools (`app_status`, `list_assistants`, `prepare_session`, `prepare_summary`, `prepare_code_review`, `prepare_followup`, `propose_assistant`) and an atomic, SHA-256 drift-safe installer ([`lib/connectors/client-install.cjs`](lib/connectors/client-install.cjs)) targeting **Claude Desktop** (`claude_desktop_config.json`), **Claude Code** (`~/.claude.json`), **Cursor**, and **Codex**. See [MCP & Claude Integration Architecture](docs/MCP_CLAUDE_ARCHITECTURE.md).
- **Model Context Protocol (MCP) Client:** Native stdio, SSE, and StreamableHTTP MCP client ([`lib/connectors/mcp.cjs`](lib/connectors/mcp.cjs), `@modelcontextprotocol/client` v2.3.1) with OAuth 2.0 PKCE loopback auth, pagination cycle protection, and explicit tool-write confirmation per call.
- **Local AI & Model Runtimes:** Built-in **llama.cpp** runtime supporting CPU and Vulkan GGUF inference (with automatic CPU fallback), verified GGUF model downloads/imports, idle model unloading, and optional **Ollama** or compatible local/cloud endpoints.
- **Local Speech & Transcription:** Persistent CPU **Whisper** engine with seven integrity-checked models, Voice Activity Detection (VAD), partial/final transcripts, custom vocabulary, dual audio-source capture, translation, and turn-based local speech synthesis (`System.Speech` / Chromium fallback).
- **Per-Profile SQLite Memory & Knowledge Base:** Isolated SQLite storage per profile with paginated search, statistics, Markdown export, reversible memory compaction, permanent assistant knowledge files, and local PDF text extraction (`pdfjs-dist`).
- **Productivity & Desktop UX:** Floating window, Notch/quick actions, system tray, editable shortcuts, explicit clipboard inspection, monitor selection, screenshot/capture protection, and synced assistant preferences across OneDrive/Google Drive/Dropbox (excluding credentials and session histories).
- **Built-in Integrations:** Official Notion connector, read-only Google Calendar/Drive/Docs/Sheets support, Obsidian integration, and recent documents per profile, with credentials isolated via Windows `safeStorage`.
- **Signed Auto-Updater & Verification:** NSIS Setup and Portable builds (`Lume-0.2.0-Setup-x64.exe` / `Lume-0.2.0-Portable-x64.exe` in [Releases](https://github.com/deusbr/lume/releases)) backed by an **Ed25519 + SHA-256** manifest updater and automated **Node.js + Playwright** test coverage.

## Quick Start & Development (Windows x64, Node.js 24)

```powershell
npm ci
npm run prepareNative
npm test
npm run check
npm start
```

- `npm run prepareNative` downloads and verifies official runtimes/models, builds the audio helper, and prepares `llama.cpp`.
- `npm run build` packages NSIS and Portable Windows installers (`--publish never`).
- Architecture & Guides: [MCP & Claude Integration Architecture](docs/MCP_CLAUDE_ARCHITECTURE.md), [Configuration Guide (PT-BR)](docs/configuracao.md), [Integrations (PT-BR)](docs/integrations.md), [102-Item Implementation Matrix (PT-BR)](docs/matriz-implementacao.md), and [Release Process (PT-BR)](docs/release.md).

## License

MIT License — see [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for third-party runtime notices.
