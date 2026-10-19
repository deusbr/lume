# Releases do Lume

O instalador e o portátil são produzidos para Windows x64, mantendo `appId: local.lume.desktop` e a pasta de dados usada pelo Lume 0.1. O fechamento da janela principal recolhe para a bandeja; **Sair** encerra o processo.

## Configuração de empacotamento

O `package.json` deve incluir `release-public-key.pem` em `build.files`, manter `signExecutable: false` enquanto não houver certificado Authenticode e usar:

```json
{
  "win": {"target": ["nsis", "portable"]},
  "nsis": {"oneClick": false, "allowToChangeInstallationDirectory": true, "deleteAppDataOnUninstall": false, "artifactName": "Lume-${version}-Setup-x64.exe"},
  "portable": {"artifactName": "Lume-${version}-Portable-x64.exe"}
}
```

O runtime Whisper precisa incluir `whisper-server.exe` e as DLLs. O auxiliar WASAPI e o runtime local devem ser preparados pelos respectivos scripts antes da compilação quando configurados no empacotamento.

## Assinatura de atualizações

Usar um par **Ed25519** exclusivo do Lume. A chave pública `release-public-key.pem` deve entrar no código e no pacote. Guardar a chave privada criptografada fora do repositório/pacotes, e cadastrar a PEM privada como secret do GitHub `RELEASE_SIGNING_KEY`; sua senha, quando usada, fica no secret separado `RELEASE_SIGNING_PASSPHRASE`. Não enviar chaves a logs, issues ou chat. Uma troca de chave pública exige versão instalada por um canal já confiável.

`node scripts/release-manifest.cjs --directory dist` exige Setup e portátil, calcula tamanho/hash SHA-256 e assina o JSON canônico com todas as chaves ordenadas. A assinatura é validada novamente com a chave pública distribuída antes de gravar `lume-update.json`. O script nunca gera chaves privadas.

O fluxo `.github/workflows/release.yml` testa, prepara o Whisper, compila NSIS/portátil, assina o manifesto e publica arquivos em releases de `deusbr/lume` para tags `vX.Y.Z`. Execução manual produz artefatos para revisão e não publica uma release. A versão do pacote precisa corresponder à tag. O repositório não pode conter dados pessoais, perfis ou credenciais.

## Contrato com o processo principal

Instanciar `Updater` com `{app,directory,emit,isSessionActive,publicKey,snapshotData}` e expor `operations` pela ponte IPC. `snapshotData(destination)` recebe um diretório; `Store.backup(destination)` produz uma cópia consistente SQLite e preserva o JSON legado quando presente. Não copie apenas o banco aberto sem WAL/backup consistente. Não é necessário copiar tokens para o backup de atualização. O updater bloqueia a instalação sem esse callback.

`updates.install({confirm:true})` revalida assinatura, versão, tamanho e hash; bloqueia enquanto houver sessão/gravação/geração ativa; cria backup; verifica novamente as sessões; inicia o instalador e encerra o app. O portátil é distribuído para uso manual, enquanto atualizações internas usam o Setup NSIS. O usuário com versão portátil pode instalar a nova versão sem remover a antiga.

O aplicativo não executa downloads por iniciativa própria. `updates.check` consulta a última release estável; `updates.download` só baixa o instalador previamente verificado; `updates.cancel` interrompe rede/download; `updates.install` exige confirmação explícita. Ausência de chave pública desabilita atualizações, e manifestos não assinados nunca são aceitos. O Windows ainda pode exibir aviso de editor desconhecido: a assinatura do manifesto protege o atualizador, não substitui Authenticode.

## Verificação

- Executar `node --test tests/desktop.test.cjs tests/updater.test.cjs` para fila de captura, falhas, atalhos, limites de monitor, assinatura, downgrade, desvio de URL, adulteração e bloqueio de instalação durante sessão.
- Validar em Windows real a bandeja, Notch com passagem de cliques, alteração de DPI/monitor, suspensão e captura física. Essas verificações não podem ser declaradas aprovadas apenas com testes simulados.
- Instalar o Setup em perfil isolado sobre uma versão anterior; conferir autenticação, migração e restauração do backup. Não instalar sobre dados pessoais durante testes automatizados.

## Limite da captura

`ScreenCaptureWorker` é uma fila de trabalho serial com prazo, invalidação de resultados antigos e recuperação após mudanças de tela/suspensão. A API `desktopCapturer` do Electron só funciona no processo principal; não é um `worker_threads` nativo. Capturas simultâneas são limitadas e pedidos atrasados têm seus resultados descartados. Um travamento nativo do processo principal exige reabrir o aplicativo; o serviço não promete isolamento de processo que a implementação não oferece.
