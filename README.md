# RadioHub

Programe o seu rádio no Mac em minutos: conecte, deixe a IA montar os canais da sua região, revise e grave.

**Download:** [radiohub.diegocosta.digital](https://radiohub.diegocosta.digital) · [Versões](https://github.com/diegocostadf/radiohub/releases)

- Mais de 500 modelos de rádio, com os drivers do [CHIRP](https://chirpmyradio.com)
- Assistente de IA com opções grátis (Groq, Google Gemini, OpenRouter, Ollama) e pagas (DeepSeek, Claude)
- Backup automático antes de qualquer alteração
- Importa e exporta CSV no formato do CHIRP
- Avisa sozinho quando sai uma versão nova

Requisitos: Mac com Apple Silicon (M1 ou mais novo), macOS 12 ou superior.

## Instalação
1. Abra o `RadioHub-mac-arm64.dmg` e arraste o RadioHub para Aplicativos.
2. Na primeira vez, abra o app. Se o macOS avisar que não pode verificar o desenvolvedor, vá em **Ajustes do Sistema → Privacidade e Segurança** e clique em **Abrir Mesmo Assim**.
3. Se aparecer "o app está danificado", rode no Terminal: `xattr -cr /Applications/RadioHub.app`

## Desenvolvimento
- `main.js` processo principal (Electron), `ai.js` provedores de IA, `renderer/` interface
- `engine/engine.py` motor JSON-RPC sobre a biblioteca do CHIRP (`engine/chirp`)
- Empacotar: `npm install && npm run package:mac` (precisa do Python para macOS em `python/`)
- Gerar o DMG no Mac: `build/Gerar DMG.command`

## Licença
GPL v3, a mesma do CHIRP. O RadioHub não é afiliado ao projeto CHIRP.

## Autor
Desenvolvido por **Diego Costa** · [www.diegocosta.digital](https://www.diegocosta.digital) · contato@diegocosta.digital · WhatsApp 61 99862-6377

Apoie: Pix `pix@diegocosta.digital`
