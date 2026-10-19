# Dependências de terceiros

- Electron: MIT, [electron/electron](https://github.com/electron/electron). Inclui Chromium/Node e seus avisos próprios.
- jose: MIT, [panva/jose](https://github.com/panva/jose).
- Marked: MIT, [markedjs/marked](https://github.com/markedjs/marked).
- DOMPurify: Apache-2.0 ou MPL-2.0, [cure53/DOMPurify](https://github.com/cure53/DOMPurify).
- extract-zip: BSD-2-Clause, [max-mapper/extract-zip](https://github.com/max-mapper/extract-zip).
- Whisper.cpp e GGML: MIT, [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp).
- Whisper Base: MIT, [openai/whisper](https://github.com/openai/whisper).
- SDL2, distribuído no runtime Whisper: zlib, [libsdl-org/SDL](https://github.com/libsdl-org/SDL).
- MCP TypeScript Client 2.3.1: Apache-2.0, [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk). Suas dependências transitivas mantêm os avisos nos respectivos pacotes.
- PDF.js/pdfjs-dist 6.4.299: Apache-2.0, [mozilla/pdf.js](https://github.com/mozilla/pdf.js). O pacote opcional de canvas, quando instalado, mantém suas próprias licenças.
- Zod 4.6.7: MIT, [colinhacks/zod](https://github.com/colinhacks/zod).
- NAudio 2.2.1: MIT, [naudio/NAudio](https://github.com/naudio/NAudio). Usado pelo auxiliar WASAPI original do Lume; licença em `resources/audio-helper/LICENSE.NAudio.txt`.
- System.Speech 8.0.0 e runtime .NET 8: MIT, [dotnet/runtime](https://github.com/dotnet/runtime). O auxiliar autossuficiente inclui os arquivos LICENSE e THIRD-PARTY-NOTICES em `resources/audio-helper`. O SDK .NET é ferramenta de compilação e não acompanha a distribuição do Lume.
- A alternativa de voz do Windows usa o componente System.Speech já instalado no sistema por meio do Windows PowerShell. Não inclui nem modifica uma instalação do PowerShell/Windows; vozes e componentes do Windows continuam sujeitos às licenças do sistema.
- llama.cpp/GGML b11738: MIT, [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases/tag/b11738). Os runtimes CPU/Vulkan incluem `LICENSE.llama.txt` e `SOURCE.txt` em `resources/llama/<backend>`; distribuições de backend mantêm seus arquivos adicionais de licença quando fornecidos pelo projeto.

## Pesos de modelos

Somente o Whisper Base multilíngue acompanha a instalação. Os demais modelos abaixo são downloads opcionais e são usados somente após escolha do usuário. Os catálogos contêm tamanho, origem, licença e SHA256; um arquivo que não corresponda ao hash publicado é rejeitado.

- Whisper Tiny, Base, Small, Medium, Large v3, Large v3 Turbo e a quantização Turbo q5_0: MIT, [OpenAI Whisper](https://github.com/openai/whisper/blob/main/LICENSE), conversões publicadas por [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp).
- Qwen 2.5 0.5B Instruct GGUF Q4_K_M: Apache-2.0, publicado por [Qwen](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF).
- SmolVLM 500M Instruct GGUF Q8_0 e projetor de visão Q8_0: Apache-2.0, [pesos convertidos GGML](https://huggingface.co/ggml-org/SmolVLM-500M-Instruct-GGUF) e [modelo original HuggingFaceTB](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct).
- Arquivos GGUF importados e modelos instalados no Ollama são escolhidos pelo usuário e mantêm as licenças de seus respectivos autores. O Lume não os redistribui automaticamente.

Os arquivos LICENSE das dependências são mantidos em seus pacotes e nos recursos do aplicativo. O programa Lume foi escrito separadamente; os arquivos extraídos para investigação do Perssua não estão incluídos.
