# Integrações do Lume

As conexões e documentos recentes pertencem ao perfil ativo. As credenciais ficam em `integration-secrets.bin`, protegido pelo `safeStorage` do Electron; esse arquivo não é sincronizado, exportado nem enviado ao modelo. Trocar de perfil fecha processos MCP e tentativas de autenticação em andamento. O login ChatGPT continua separado.

## Google Calendar, Drive, Docs e Sheets

1. No Google Cloud Console, crie ou selecione um projeto próprio e habilite Google Calendar API, Google Drive API, Google Docs API e Google Sheets API.
2. Configure o consentimento OAuth. Enquanto o projeto estiver em teste, inclua sua conta nos usuários de teste. O Google pode exigir verificação para disponibilizar um projeto a outras pessoas.
3. Crie um cliente OAuth do tipo **Aplicativo para computador**, baixe o JSON e importe-o em **Integrações → Google → Configurar**.
4. Escolha **Conectar** e conclua o consentimento no navegador. O retorno utiliza uma porta aleatória de `127.0.0.1`, estado aleatório e PKCE S256.

O Lume oferece leitura de calendários/eventos, pesquisa paginada no Drive, extração de texto de Docs e leitura de intervalos de Sheets. A pesquisa retorna `nextPageToken`; a próxima chamada deve reutilizá-lo. Documentos aceitam IDs retornados pela pesquisa; planilhas usam `A1:Z200` por padrão e podem receber um intervalo explícito. Arquivos textuais de até 1 MB também são aceitos. Tipos binários não são apresentados como se tivessem sido extraídos.

Os escopos são somente leitura: Calendar, Drive, Documents e Spreadsheets. Não há chave de API OpenAI, conta de serviço ou chave Google distribuída com o programa. Uma conexão salva pode renovar sua autorização; desconectar com a opção de esquecer credenciais remove o acesso local. Autorizações também podem ser revogadas em sua conta Google.

Documentação: [OAuth desktop](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Docs documents.get](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get), [Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get).

## Notion e servidores MCP

O botão Notion configura o servidor oficial `https://mcp.notion.com/mcp`, usando Streamable HTTP e OAuth no navegador. Autorize somente as páginas necessárias no consentimento do Notion.

Servidores personalizados aceitam:

- **stdio:** executável, argumentos, diretório de trabalho opcional e variáveis de ambiente protegidas. Instale o executável previamente; conectar inicia o comando configurado.
- **Streamable HTTP:** URL HTTPS; HTTP é aceito apenas no computador local.
- **SSE:** transporte legado quando exigido pelo servidor.
- **Autenticação:** OAuth com descoberta/registro dinâmico quando suportado, bearer token protegido ou nenhuma autenticação. Servidores que não oferecem registro dinâmico precisam fornecer um bearer token ou um cliente compatível; o Lume não inventa credenciais.

Não coloque segredos na URL ou nos argumentos do processo; use os campos protegidos de token, cabeçalhos ou ambiente. Escolha as conexões que o assistente poderá utilizar. O processo principal descobre as ferramentas, executa-as e apresenta progresso, conteúdo e origem.

Ferramentas sem indicação explícita de somente leitura geram uma proposta com o nome, os argumentos e a integração. Cada aprovação vale para aquela chamada, naquele perfil e sessão, por até dez minutos. Negar ou cancelar não executa a ferramenta. Metadados de somente leitura são informados pelo servidor MCP: conecte apenas servidores em que confia.

Referências de documentos retornadas em `resource_link` ou objetos estruturados com URL são guardadas nos recentes do perfil. Recursos MCP podem ser reabertos quando o servidor oferece `resources/read`; outras referências devem ser consultadas pela ferramenta de leitura do próprio servidor. Conteúdo de ferramenta/documento é dado externo, não autorização para outra ação.

Documentação: [MCP TypeScript SDK v2](https://github.com/modelcontextprotocol/typescript-sdk), [Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp).

## Obsidian

Escolha um cofre detectado ou selecione uma pasta local. A busca examina até 3.000 notas Markdown e 20.000 entradas, com profundidade máxima de 12 pastas e até 1 MB por nota. Pastas ocultas e links simbólicos não entram na busca; o acesso explícito também não atravessa links nem sai da pasta escolhida.

É possível ler, pesquisar, criar, anexar ou substituir notas. Toda gravação passa pela revisão de ferramenta. Substituir exige a revisão retornada pela leitura mais recente; notas alteradas externamente não são substituídas. Edições locais preservam uma cópia `.lume-backup-*` ao lado do arquivo.

Opcionalmente, configure a URL do plugin **Obsidian Local REST API** instalado por você e seu token no campo protegido. Somente loopback é aceito. A URL HTTP local padrão costuma ser `http://127.0.0.1:27123`; siga a configuração do seu plugin. HTTPS com certificado não confiável é recusado. Nesse modo há leitura, busca, criação e acréscimo; substituição fica restrita ao acesso direto à pasta para verificar a revisão.

## Sincronização por pasta

Escolha uma pasta sincronizada pelo cliente OneDrive, Google Drive ou Dropbox já instalado. O Lume não recebe a senha desses serviços e não precisa de suas APIs. **Enviar** e **Receber** mesclam assistentes e preferências em `lume-sync-v1.json`.

- Assistentes incluem instruções separadas e conteúdo textual da base permanente; referências a caminhos locais são removidas do formato de arquivos.
- Preferências incluem idioma, tema, tradução, insights, opções da janela e atalhos. Não incluem histórico, conexões, credenciais, executáveis, caminhos locais de modelos ou cofre.
- Mudanças simultâneas usam uma base comum por perfil. Conflitos preservam as versões local e remota; escolha uma ou mantenha ambos os assistentes.
- Cada envio grava uma revisão imutável em `lume-revisions/`. Assim, versões anteriores e gravações concorrentes da pasta permanecem recuperáveis mesmo se o provedor substituir o manifesto principal. Não exclua essa pasta sem antes guardar as revisões de que precisa.
- Na primeira sincronização, preferências diferentes também exigem resolução. Se o próprio provedor criar uma cópia de arquivo em conflito, preserve-a e compare-a às revisões antes de resolver.

A sincronização é acionada pelo usuário, sem sincronização de histórico ou de tokens. Assistentes podem conter informações pessoais fornecidas por você; a pasta escolhida recebe esse conteúdo.

## Instalar o Lume em outros agentes

O assistente de instalação oferece Codex, Cursor, Claude Desktop, Claude Code e outro cliente com JSON compatível. Para Grok ou clientes não reconhecidos, selecione explicitamente o arquivo JSON com a chave `mcpServers`; não há suposição de uma instalação padrão de Grok.

Instalar altera somente a entrada `lume`, preserva o restante e guarda uma cópia protegida da configuração anterior. Remover restaura a entrada Lume anterior, preservando outras alterações feitas depois da instalação. Se a própria entrada Lume foi editada, a remoção para e pede revisão para não sobrescrever sua mudança. Reinicie o cliente após instalar ou remover.

Use o instalador ou uma pasta permanente do Lume. Mover a versão portátil ou usar um executável extraído temporariamente pode invalidar o caminho registrado; reinstale a integração a partir da localização permanente.

O servidor MCP de entrada oferece `app_status`, `list_assistants`, `prepare_session`, `prepare_summary`, `prepare_code_review`, `prepare_followup` e `propose_assistant`. Handoffs v1 continuam válidos; v2 aceita oito arquivos de texto de até 128 mil caracteres cada, com limite total de 2 MB e expiração de 15 minutos. Não são executados arquivos nem enviadas mensagens automaticamente: o pedido abre no Lume para revisão.

## Verificação realizada

`node --test tests/integrations.test.cjs` verifica credenciais criptografadas com armazenamento de teste, perfil, revisão de escrita, arquivo Obsidian real, migração de referências, sincronização e preservação de configurações. O SDK MCP real é exercitado contra servidores locais de teste em stdio, Streamable HTTP e SSE, incluindo descoberta OAuth, registro dinâmico, PKCE e callback. OAuth Google e as APIs Google usam respostas simuladas.

Esses testes não demonstram consentimento em uma conta real Google/Notion nem compatibilidade com todos os servidores MCP ou clientes instalados. Essa validação ocorre depois que você configurar e autorizar as respectivas contas. Nenhuma credencial pessoal ou requisição de IA paga foi usada nesses testes.
