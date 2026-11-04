# RadioHub

Programe o seu rádio em minutos: conecte, deixe a IA montar os canais da sua região, revise e grave.

**Download:** [radiohub.diegocosta.digital](https://radiohub.diegocosta.digital) · [Versões](https://github.com/diegocostadf/radiohub/releases)

- Mais de 500 rádios analógicos, com os drivers do [CHIRP](https://chirpmyradio.com)
- Rádios DMR (AnyTone, TYT, Retevis, Radioddity, Baofeng DMR, OpenGD77) com o [qdmr](https://dm3mat.darc.de/qdmr/): canais com color code e time slot, contatos, listas de grupo, zonas e DMR ID
- Assistente de IA com opções grátis (Groq, Google Gemini, OpenRouter, Ollama) e pagas (DeepSeek, Claude)
- Backup automático antes de qualquer alteração
- Importa e exporta CSV no formato do CHIRP; abre e salva codeplugs .yaml do qdmr
- Avisa sozinho quando sai uma versão nova

Sistemas: Mac (Apple Silicon e Intel, macOS 12 ou superior) e Windows 10/11 (64 e 32 bits). Nesta versão, o DMR funciona no Mac.

## Instalação
Veja o passo a passo de cada sistema em [radiohub.diegocosta.digital](https://radiohub.diegocosta.digital/#download).

## Desenvolvimento
- `main.js` processo principal (Electron), `ai.js` provedores de IA, `renderer/` interface
- `engine/engine.py` motor JSON-RPC que distribui os pedidos para os provedores:
  - `engine/providers/chirp.py` rádios analógicos sobre a biblioteca do CHIRP (`engine/chirp`)
  - `engine/providers/qdmr.py` rádios DMR pelo `dmrconf` do qdmr
  - `engine/providers/base.py` descreve o formato de canal comum aos dois
- `build/bundle-dmrconf.sh` empacota o `dmrconf` com as bibliotecas Qt para ir dentro do app
- O GitHub Actions (`.github/workflows/release.yml`) gera e publica tudo quando a versão do `package.json` muda

## Licença
GPL v3, a mesma do CHIRP e do qdmr. O RadioHub não é afiliado a esses projetos.

## Autor
Desenvolvido por **Diego Costa** · [www.diegocosta.digital](https://www.diegocosta.digital) · contato@diegocosta.digital · WhatsApp 61 99862-6377
