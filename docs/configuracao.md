# Configuração do Lume 0.2.0

Este guia descreve Windows x64. Recursos implementados e verificações realizadas são estados diferentes: consulte a [matriz completa](matriz-implementacao.md) antes de interpretar uma opção como já validada com seu hardware ou suas contas.

## Instalação e primeira abertura

Use os arquivos da [release oficial de `deusbr/lume`](https://github.com/deusbr/lume/releases):

| Arquivo | Uso |
|---|---|
| `Lume-0.2.0-Setup-x64.exe` | Instalação para o usuário, com escolha de pasta e desinstalação. |
| `Lume-0.2.0-Portable-x64.exe` | Uso sem instalar; mantém dados no perfil do Windows. |
| `lume-update.json` | Manifesto assinado consumido pelo atualizador. Não execute como programa. |

O assistente inicial conduz conta/modelo, áudio e preferências. A interface oferece português, inglês e espanhol. Encerrar a janela principal recolhe o aplicativo; use **Sair** na bandeja para encerrar o processo. Para configurar a integração MCP em outros agentes, prefira uma instalação ou pasta extraída permanente: um portátil pode executar a partir de uma extração temporária.

Se o Windows bloquear um executável, o diagnóstico deve ser resolvido pela política normal do computador ou por uma distribuição assinada. O aplicativo não altera políticas de Controle de Aplicativo nem desativa proteções. A assinatura do manifesto de atualização não substitui a assinatura Authenticode do instalador.

## Atualizar sem perder o histórico

1. Na versão atual, encerre gravações e respostas em andamento. Feche o Lume pela bandeja antes de uma instalação manual.
2. Faça um **Backup dos dados** em Configurações e guarde o arquivo resultante. Para uma cópia manual, com o aplicativo encerrado, preserve a pasta `%APPDATA%\Lume` inteira.
3. Execute o Setup da nova versão. O instalador não está configurado para excluir dados ao desinstalar.
4. Na primeira abertura, confira o perfil e a área de histórico anterior. Não apague o JSON legado até confirmar sua importação e o backup.

O banco atual é `workspace.sqlite`, acompanhado por arquivos WAL/SHM quando aberto. Não copie apenas o arquivo principal durante uso: o comando de backup produz uma cópia consistente. Para restaurar manualmente, encerre o app, preserve primeiro uma cópia dos dados atuais e coloque o banco de backup como `workspace.sqlite`; não mantenha WAL/SHM de um banco diferente junto ao arquivo restaurado.

Na migração de 0.1, `workspace.json` é mantido intacto e uma cópia vai para `backups/`. Sessões legadas ficam sem atribuição em **Histórico anterior**, evitando associar dados automaticamente à conta errada. Selecione a conta de destino, escolha as sessões e importe. Os assistentes antigos também podem ser importados. Trocar de conta separa sessões, conexões, recentes e preferências; não transforma o login ChatGPT em sincronização de conversas.

Credenciais protegidas dependem do usuário/Windows que as criptografou. Copiar os arquivos de tokens para outro computador não garante reconexão; entre novamente nesse computador. Backups de atualização não precisam conter os tokens.

## Entrar com ChatGPT

Em **Configurações → Conta**, escolha **Entrar com ChatGPT**, conclua a autorização no navegador oficial da OpenAI e permita o uso do plano. Depois carregue/escolha um modelo disponível.

- Não há necessidade de uma chave de API OpenAI.
- A conta precisa ser elegível e autorizar o uso solicitado. Disponibilidade de modelos e ferramentas pode variar por plano ou workspace.
- Você pode adicionar, selecionar, reconectar ou desconectar contas. Verifique a conta ativa antes de abrir dados ou usar ferramentas.
- O login anteriormente funcionando foi preservado. Validações autorizadas com a conta real confirmaram catálogo, streaming, resumo salvo, encerramento, execução da ferramenta de pesquisa de memória e pesquisa web com citação; não mediram limites prolongados.
- Pesquisa web funciona somente quando o modelo/conta permite a ferramenta. Uma recusa de capacidade é apresentada; o Lume não muda silenciosamente para outro provedor.

OAuth utiliza PKCE, estado/nonce, validação do ID token e armazenamento `safeStorage`. O fluxo é separado dos tokens Google/Notion. O aplicativo não importa seu histórico da interface web ChatGPT.

Referência: [login com ChatGPT](https://developers.openai.com/siwc/quickstart) e [limitações de capacidades](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Modelos locais

Em Modelos, escolha um dos caminhos:

| Opção | Preparação |
|---|---|
| llama.cpp integrado | Baixe um item do catálogo ou importe GGUF. O runtime já acompanha a distribuição preparada. |
| Ollama | Instale e inicie o Ollama separadamente; selecione um modelo instalado. |
| Endpoint compatível | Inicie um servidor compatível no próprio computador e informe sua URL local. |

Endpoints compatíveis e Ollama aceitam somente loopback (`127.0.0.1`, `localhost` ou `::1`). Não são destinados a provedores cloud com chave, servidores LAN ou URLs que contenham credenciais. O runtime próprio usa porta e credencial temporárias locais, geridas pelo processo principal.

Comece com um modelo leve em CPU. O catálogo apresenta tamanho e estimativa de memória; o consumo real também depende do contexto e dos outros programas abertos. Para imagens, escolha um modelo de visão e seu projetor; um modelo textual não passa a aceitar imagens por causa do formato GGUF. PDF pode precisar de extração textual no modo local.

CPU é o padrão. Vulkan exige runtime e driver compatíveis; uma falha de aceleração tenta CPU. A geração CPU foi exercitada com Qwen2.5 0.5B; o runtime Vulkan foi preparado, mas geração no hardware Vulkan permanece pendente. CUDA não foi incluído nesta escolha de distribuição.

É possível separar modelo/provedor local ou ChatGPT para conversa, resumo, tradução e insights. O Lume envia apenas parâmetros aceitos pelo caminho correspondente; parâmetros locais não são enviados como opções arbitrárias ao login ChatGPT. Ajuste o tempo de inatividade para descarregar o modelo local; zero desativa a descarga automática.

## Áudio e transcrição

O Whisper Server mantém o modelo em memória. O Base multilíngue acompanha o aplicativo; outros modelos são baixados sob demanda com SHA-256. O catálogo mostra sete opções, tamanho e estimativas. Modelos maiores precisam de mais memória/tempo. Este runtime de transcrição utiliza CPU.

Escolha idioma fixo ou automático e, se necessário, um vocabulário de apoio. O vocabulário é contexto, não uma lista que garanta grafia. As parciais podem mudar no refinamento final. “Você” identifica o microfone e “Outro lado” o sistema; isso não identifica pessoas diferentes dentro da mesma fonte.

O auxiliar nativo WASAPI/NAudio oferece dispositivos e fontes independentes quando sua execução é permitida. **Neste Windows, o Controle de Aplicativo bloqueou o auxiliar**, portanto sua captura nativa não foi validada. O caminho alternativo usa o Chromium:

- Para o microfone, escolha um dispositivo e conceda permissão quando solicitado.
- Para áudio do sistema, escolha a tela/janela compatível e habilite compartilhamento de áudio na seleção. Se não houver trilha de áudio, o Lume informa a indisponibilidade.
- No caminho Chromium, a seleção nativa de uma saída WASAPI não é equivalente à seleção de compartilhamento de tela. Perda de dispositivo encerra a captura e pede para iniciar novamente; não há promessa de troca física automática nesse caminho.
- As fontes continuam separadas, com controles e níveis independentes. Desligue o microfone para usar somente o sistema.

O teste Chromium usou uma entrada de fala de arquivo, não um microfone físico: AudioWorklet → VAD → Whisper persistente → transcrição salva no SQLite, incluindo pausa/retomada e liberação de trilhas. Microfone físico, loopback e mudança de dispositivos precisam ser testados no seu computador.

Ative tradução para escolher o idioma de destino. Falhas podem ser repetidas no trecho correspondente; uma repetição concluída remove o estado antigo de erro. Tradução e sugestões usam o modelo configurado, podendo consumir uso ChatGPT. Você pode alternar texto original e traduzido.

## Conversa por voz e insights

No modo de voz, uma fala final do microfone entra como mensagem comum da sessão. A captura é pausada durante a resposta/leitura e retomada após a conclusão correspondente. Falas do sistema não disparam automaticamente esse modo. Uma falha de leitura mantém a resposta escrita válida.

O Lume tenta voz nativa e depois `System.Speech` do Windows pelo PowerShell instalado, sem baixar um novo shell. A alternativa Chromium usa somente vozes marcadas como locais. Instale uma voz local do Windows para o idioma desejado se nenhuma estiver disponível. O teste do backend Windows sintetizou áudio WAV em memória e verificou cancelamento; reprodução audível não foi validada. Você pode interromper a leitura.

Os modos de insights são somente perguntas, moderado, proativo, máxima atividade e notas de reunião. Configure os gatilhos e intervalos; insights aparecem separados do chat, com contexto recente e tentativa de evitar repetição. São sugestões, não garantias de acerto. A captura automática de tela tem aviso próprio e começa desativada; ligue-a somente quando quiser fornecer esse contexto.

## Assistentes, resumos e memória

Crie ou duplique um assistente, escolha categoria e configure instruções de conversa, insights, perguntas seguintes, resumo e ferramentas. A opção de responder apenas com fundamento orienta o modelo; não assegura veracidade. Os arquivos permanentes aceitam texto e PDF com texto extraível. PDFs apenas com imagem não recebem OCR local automaticamente.

Uma sessão copia instruções/conhecimento do assistente ao ser criada, preservando o contexto de conversas antigas quando você editar a biblioteca. Exportar/importar usa o formato versionado do Lume, não formatos privados de outros produtos.

O resumo pode ser gerado ao encerrar, atualizado durante a sessão, editado em Markdown ou reescrito com uma instrução. Revise conteúdo, título, decisões e responsáveis antes de compartilhar. Para e-mail, o Lume abre um rascunho `mailto:` ou um arquivo `.eml` quando o resumo é longo; o envio continua no seu aplicativo de e-mail.

A memória pesquisa apenas o perfil ativo, fornece referências das sessões e permite retomá-las. Respostas com falha/interrompidas não são usadas como respostas confirmadas na recuperação. A compactação de conversas preserva os registros originais e pode ser desfeita.

## Google, Notion, MCP e Obsidian

Em **Conexões**, escolha as integrações que o assistente poderá usar. Credenciais vão para armazenamento protegido e escritas de ferramentas geram uma revisão com os argumentos daquela chamada. A aprovação não autoriza automaticamente chamadas futuras.

Para Google: crie seu projeto Google Cloud, habilite Calendar/Drive/Docs/Sheets APIs, configure consentimento/usuário de teste e crie um cliente OAuth **Aplicativo para computador**. Importe seu JSON no Lume e conecte pelo navegador. As APIs são somente leitura; resultados paginados e seleção de documentos ficam no perfil. Não é uma chave API OpenAI.

Notion usa `https://mcp.notion.com/mcp` com OAuth oficial. MCP personalizado aceita stdio, Streamable HTTP e SSE. Só configure executáveis e servidores em que confia: as indicações de somente leitura do servidor são metadados externos.

Para Obsidian, escolha um cofre detectado/pasta ou configure seu Local REST API instalado separadamente. Busca/leitura acessam notas sob demanda; gravação de resumo requer revisão, preserva backup no acesso direto e verifica a revisão antes de substituir uma nota. Links simbólicos e caminhos que escapem da pasta são recusados.

O assistente instala/remove a entrada MCP `lume` em Codex, Cursor, Claude Desktop e Claude Code, preservando outras configurações. Outros clientes, incluindo Grok quando compatível, exigem um arquivo JSON escolhido explicitamente. O caminho padrão de uma instalação Grok não é inferido.

Consulte [integrações e escopos](integrations.md) para configuração detalhada e limites. Google/Notion com contas reais continuam dependentes da sua autorização; as validações automatizadas não substituem esse teste.

## Sincronização por pasta

Escolha uma pasta já sincronizada pelo aplicativo OneDrive, Google Drive ou Dropbox. **Enviar**/**Receber** mesclam assistentes e preferências; não é necessário entregar a senha desses serviços ao Lume.

Conflitos preservam versões local e remota. Você pode escolher uma versão ou manter ambos os assistentes. Revisões imutáveis ficam em `lume-revisions/`; preserve-as até confirmar a sincronização nos computadores. A primeira sincronização também pode apresentar preferências diferentes para revisão.

Não são sincronizados histórico/sessões, credenciais, conexões, caminhos locais de modelos/executáveis ou cofre. O conteúdo textual dos arquivos permanentes dos assistentes é sincronizado. Essa pasta deve ter o mesmo nível de privacidade que você deseja para esse conhecimento.

## Janelas, captura e atualizações

Use a janela flutuante, Notch e bandeja para abrir sessões, controlar áudio e retornar à principal. Atalhos podem ser personalizados; combinações ocupadas são informadas. Monitores podem ser selecionados e limites de janela são recompostos quando o Windows notifica mudanças.

A captura de tela tem fila, prazo e recuperação lógica no processo principal. Ela não está isolada em processo/worker nativo: um travamento do processo principal ainda pode exigir reabrir o Lume. Proteção de captura, opacidade e passagem de cliques dependem das APIs Windows/Electron e do aplicativo que está capturando.

Em Atualizações, verifique a release, revise a nova versão, baixe e confirme a instalação. O aplicativo verifica manifesto Ed25519, origem, tamanho e SHA-256, bloqueia instalação durante sessões/gravação/geração e cria backup. Sem chave pública válida ou manifesto assinado, a atualização é recusada. Para detalhes de publicação, consulte [releases](release.md).

Instalação/upgrade físicos, monitores/DPI, suspensão/desbloqueio, áudio físico e comportamento de proteção em outros programas não foram declarados aprovados por testes de lógica ou mocks.
