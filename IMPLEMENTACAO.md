# Lume pessoal

Entrega Windows x64 com conta ChatGPT existente, modelos locais, histórico por perfil,
sessões/resumos/memória, assistentes completos, áudio local separado por origem,
tradução, insights, ferramentas MCP/Google/Notion/Obsidian, sincronização por pasta,
rascunhos de e-mail, Notch/ActionBar, instalador e atualizações assinadas por manifesto.

Não inclui provedores de IA por chave, planos comerciais, indicações ou recursos de
outras plataformas. Contas externas precisam ser autorizadas pelo dono. Testes
simulados e recursos configuráveis não são apresentados como validação de serviços reais.

Os serviços registram operações em `window.lume.call` por uma lista explícita.
Eventos assíncronos carregam `profileId`, `sessionId` e `requestId` quando aplicável.
Segredos ficam no processo principal e não participam da sincronização ou das releases.
