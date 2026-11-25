# Lume Desktop 0.2.0 — Open-Source Local AI & Model Context Protocol (MCP) Desktop Assistant

[![CI](https://github.com/deusbr/lume/actions/workflows/ci.yml/badge.svg)](https://github.com/deusbr/lume/actions/workflows/ci.yml)
[![Release](https://github.com/deusbr/lume/actions/workflows/release.yml/badge.svg)](https://github.com/deusbr/lume/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 24](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](package.json)

[English](#lume-desktop-020--open-source-local-ai--model-context-protocol-mcp-desktop-assistant) | [Português (BR)](#lume-desktop-020)

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

---

# Lume Desktop 0.2.0

Assistente pessoal para Windows x64, com conta ChatGPT sem chave de API, modelos locais, memória entre sessões, transcrição local e ferramentas conectadas. Implementação independente, com identidade visual própria e código MIT.

## Instalar e começar

Baixe **Lume-0.2.0-Setup-x64.exe** ou **Lume-0.2.0-Portable-x64.exe** nas [releases oficiais](https://github.com/deusbr/lume/releases). O Setup permite escolher a pasta de instalação e preserva os dados na atualização/desinstalação. Use o portátil em uma pasta permanente quando configurar outros agentes para abrir o Lume.

1. Abra o aplicativo e conclua a configuração inicial.
2. Em **Configurações → Conta**, entre com ChatGPT e autorize o uso do plano no navegador da OpenAI. Não é necessário criar uma chave OpenAI.
3. Selecione um modelo disponível, escolha um assistente e crie uma sessão. Para uso inteiramente local, selecione Ollama, o runtime llama.cpp integrado ou um endpoint compatível no próprio computador.
4. Escolha as fontes de áudio antes de começar a gravar. A captura e o envio de mensagens são ações explícitas.

O login ChatGPT existente foi preservado. Com autorização do usuário, a versão 0.2 foi exercitada em uma conta real: catálogo de modelos, resposta em streaming, resumo persistente, encerramento de sessão, ferramenta de pesquisa de memória e pesquisa web com citação clicável funcionaram. Elegibilidade do plano, modelos, ferramentas e limites dependem da OpenAI e da conta. O login não importa conversas já existentes no ChatGPT.

## O que está disponível

- **Sessões e memória:** SQLite por perfil, busca paginada, estatísticas, encerramento/retomada, anotações, exportação Markdown, memória com referências e compactação reversível sem apagar os registros originais.
- **Assistentes:** busca/categorias, duplicação, importação/exportação versionada, instruções por tarefa, arquivos permanentes de conhecimento e extração local de texto de PDF.
- **Resumos:** geração final e durante a sessão, reescrita com instrução, editor Markdown/prévia, cópia por seção, perguntas seguintes e rascunho de e-mail para revisar no seu aplicativo de e-mail.
- **Áudio e voz:** Whisper persistente na CPU, sete modelos com integridade, VAD, parciais/finais, vocabulário, fontes separadas, tradução e conversa em turnos com leitura local do Windows.
- **Modelos locais:** catálogo leve de texto/visão, download verificado, importação GGUF, CPU/Vulkan com recuperação para CPU, descarregamento por inatividade e modelos separados por operação. Ollama continua opcional.
- **Ferramentas:** cliente MCP stdio/HTTP/SSE com OAuth, Notion oficial, Google Calendar/Drive/Docs/Sheets em leitura, Obsidian e documentos recentes por perfil. Escritas de ferramentas precisam de revisão por chamada.
- **Desktop:** janela flutuante, Notch/ações, bandeja, atalhos editáveis, análise explícita da área de transferência, seleção de monitor, opacidade/proteção e recuperação de janelas.
- **Compartilhamento:** assistentes/preferências por pasta sincronizada, com resolução de conflitos; handoffs MCP com texto e revisão antes de enviar.
- **Distribuição:** Setup e portátil; atualizador com manifesto Ed25519, tamanho/SHA-256, confirmação e backup antes da instalação.

Leia o [guia de configuração](docs/configuracao.md), as [integrações](docs/integrations.md) e a [matriz dos 102 itens](docs/matriz-implementacao.md). A matriz separa implementação de verificação; não é uma afirmação de equivalência integral a outro produto.

## Áudio neste ambiente

O auxiliar próprio WASAPI/NAudio foi compilado, mas a política de Controle de Aplicativo deste Windows bloqueou sua execução. Nenhuma política do sistema foi alterada. O Lume oferece captura alternativa pelo Chromium: o microfone foi exercitado com um arquivo de fala de teste através do AudioWorklet, VAD, Whisper e SQLite. Microfone físico, seleção de saída nativa e loopback físico não foram validados nesta entrega.

A leitura usa vozes locais, preferindo o auxiliar quando permitido e depois o `System.Speech` do Windows pelo PowerShell instalado. O backend do Windows foi testado com síntese para WAV e cancelamento; reprodução audível em um dispositivo físico permanece pendente. O Chromium é a última alternativa quando a síntese do sistema não está disponível.

Whisper está configurado para **CPU**; aceleração GPU de transcrição não é oferecida por este runtime. O llama.cpp CPU gerou uma resposta real com Qwen2.5 0.5B. O runtime Vulkan foi incluído; geração Vulkan precisa de validação no hardware correspondente.

## Dados e atualização

Os dados ficam em `%APPDATA%\Lume`. Mensagens/transcrições/notas no SQLite não são criptografadas pelo Lume. Credenciais ChatGPT e das integrações ficam separadas, protegidas pelo `safeStorage` do Windows, e não são incluídas na sincronização.

Na primeira abertura, um `workspace.json` antigo é preservado e copiado para backup antes da migração. As sessões antigas aparecem na área de **Histórico anterior** até você escolher o perfil de destino e importar. Faça um backup antes de atualizar e confira a conta selecionada antes de importar o histórico legado.

Assistentes e preferências podem ser sincronizados por uma pasta já gerida por OneDrive, Google Drive ou Dropbox. **Sessões, credenciais e caminhos locais não são sincronizados.** O conteúdo textual da base de conhecimento dos assistentes faz parte dessa pasta.

Ao usar ChatGPT, mensagens, anexos, contexto selecionado e transcrições pertinentes são enviados à OpenAI. Google/Notion/MCP acessam somente as conexões que você configurar e autorizar. Pesquisa web depende do modelo/conta ChatGPT e apresenta fontes quando retornadas; no modo local ela é informada como indisponível.

O atualizador verifica assinatura do manifesto e hash do arquivo; isso **não equivale a uma assinatura Authenticode do executável**. Encerre as sessões antes de instalar uma atualização. O Windows pode informar editor desconhecido ou aplicar sua política de execução; o Lume não desativa proteções do sistema.

## Desenvolvimento

Requer Windows x64 e Node.js 24. O Electron distribuído inclui o Node com `node:sqlite` utilizado pelo aplicativo.

```powershell
npm ci
npm run prepareNative
npm test
npm run check
npm start
```

`prepareNative` baixa e verifica runtimes/modelos oficiais, compila o auxiliar de áudio e prepara o llama.cpp. A primeira preparação requer internet e espaço em disco; o SDK .NET é baixado para a pasta de ferramentas do trabalho de compilação. Não configure `OPENAI_API_KEY`: o modo ChatGPT usa OAuth.

```powershell
npm run build
```

A compilação gera NSIS e portátil, sem publicar automaticamente. O fluxo de release e a assinatura do manifesto estão descritos em [docs/release.md](docs/release.md). A chave privada de atualização fica fora do código e dos pacotes; somente a chave pública é distribuída.

## Verificação e limites

Há testes de persistência/migração, isolamento por perfil, streaming, OAuth, memória/resumos, ferramentas, áudio, sincronização, janelas e atualizações. Smokes exercitaram o Electron real com dados isolados, Whisper persistente, geração local CPU e o fluxo de captura Chromium com entrada de teste. Google e MCP externo foram exercitados com fixtures locais/respostas simuladas. Uma validação adicional autorizada utilizou a conta ChatGPT real para catálogo, streaming, resumo, encerramento, ferramenta de memória e pesquisa web com citação.

Google e Notion exigem configuração/consentimento e validação com suas contas reais. Instalação física sobre uma versão anterior, múltiplos monitores/DPI, suspensão/desbloqueio, áudio físico, geração Vulkan e comportamento da proteção de captura em outros aplicativos permanecem verificações manuais. O processo de captura de tela é uma fila recuperável no processo principal do Electron, sem isolamento nativo em um worker separado.

Recursos comerciais, provedores cloud com chave própria, serviços privados de terceiros, automações não comprovadas e funções exclusivas de macOS/Linux estão fora desta versão para uso pessoal.

Código próprio sob MIT; runtimes, modelos e dependências mantêm suas licenças. Consulte `THIRD-PARTY-NOTICES.md` e os avisos que acompanham os arquivos nativos.

O ZIP `Lume-0.2.0-Windows-x64.zip` contém a pasta completa para execução manual. O runtime oficial é mantido sem edição de bytes. Setup/portátil não possuem certificado Authenticode e podem ser bloqueados por uma política que exija editor confiável; consulte [distribuição e restrições](docs/release.md).
