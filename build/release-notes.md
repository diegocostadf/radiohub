## Novidades da 0.4.0: rádios DMR
- **Suporte a rádios DMR** de AnyTone (AT-D868UV, D878UV, D878UVII, D578UV), TYT (MD-390, MD-UV390, MD-2017), Retevis (RT3S, RT8, RT82, RT84), Radioddity (GD-77, GD-73), Baofeng (RD-5R, DM-1701, DR-1801UV, DM-32UV) e firmwares OpenGD77 / OpenUV380
- Na tabela de canais, os canais DMR ganham **color code, time slot, contato de transmissão e lista de escuta**
- Novas abas para editar **contatos (talkgroups), listas de grupo, zonas e o seu DMR ID**
- Abre e salva codeplugs no formato **.yaml do qdmr**
- O motor do app foi separado em provedores: CHIRP para os mais de 500 rádios analógicos e qdmr para DMR, com o mesmo fluxo de conectar, revisar e gravar
- Backup automático do codeplug antes de cada gravação

**Observação:** nesta versão o DMR funciona no Mac. No Windows os modelos DMR aparecem na lista, mas a gravação chega numa próxima versão. O suporte DMR usa o qdmr (dm3mat.darc.de/qdmr), software livre GPL v3.

## Qual baixar
| Sistema | Arquivo |
|---|---|
| Mac com Apple Silicon (M1 ou mais novo) | RadioHub-mac-arm64.dmg |
| Mac com Intel | RadioHub-mac-x64.dmg |
| Windows 10/11 64 bits | RadioHub-Setup-win-x64.exe |
| Windows 10 32 bits | RadioHub-Setup-win-x86.exe |

Instruções de instalação: https://radiohub.diegocosta.digital/#download

Desenvolvido por Diego Costa · www.diegocosta.digital · Apoio via Pix: pix@diegocosta.digital
