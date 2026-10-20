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
