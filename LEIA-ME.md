# Remédios para iPhone

App iOS de verdade (Capacitor 8) gerado a partir do protótipo aprovado e das regras do app de Windows v0.4. A compilação roda no Codemagic, na nuvem, e a instalação é feita pelo Windows com o Sideloadly. Não precisa de Mac nem de conta paga da Apple.

---

## 1. Auditoria: o que existia

| Peça | Estado antes |
|---|---|
| App de Windows (Electron) | Funcional. Usa `window.api` (Electron) e `shared/logic.js`/`plan.js`. Esses dois arquivos de lógica **não estavam no projeto**, só a interface. |
| Protótipo iPhone (`Remedios iPhone.dc.html`) | Só visual: dados fixos de exemplo, hora simulada (10:32), resposta do Gemini inventada, notificação e alarme encenados, botão "Sincronizar com o PC" sem efeito. Roda num runtime de design (React via CDN) que não funciona offline. |

Conclusão: dava para aproveitar o **design, a navegação e as regras**, mas não o código do protótipo. A interface foi portada para HTML/CSS/JS puro, no mesmo estilo do `app.js` do Windows, e embrulhada com Capacitor. Não tem framework nem etapa de build da interface.

## 2. O que foi feito nesta versão (v0.5.0)

Pasta `ios-app/`:

```
codemagic.yaml          compilação na nuvem → Remedios-sem-assinatura.ipa
package.json            Capacitor 8 + plugins oficiais
capacitor.config.json   appId com.pietro.remedios, nome "Remédios"
src/native.js           ponte para os plugins (empacotada pelo esbuild na compilação)
scripts/copiar-fontes.mjs  fontes do Windows (Bricolage, IBM Plex, DM Mono) para uso offline
assets/icon-only.png    ícone (Pílu), aplicado na compilação
www/index.html, styles.css, app.js, logica.js   o app
```

### Funciona de verdade (código real, sem simulação)
- **Navegação aprovada:** abas Hoje · Redução · Estoque · Assistente · Ajustes. Remédios fica dentro de Ajustes, com botão de voltar.
- **Hora e data reais**, com virada de dia.
- **Persistência local** em `@capacitor/preferences` (UserDefaults do iOS). Os dados sobrevivem a fechar o app e a renovar a assinatura.
- **Offline:** tudo fica no aparelho. Só o Assistente usa a internet.
- **Doses:** Tomei, pular e desfazer. O estoque desce e sobe junto. A sequência de dias é calculada a partir do histórico.
- **Redução:** etapas, avançar com confirmação, segurar e retomar (a contagem pausa de verdade), plano em modo rápido com prévia, check-in diário e a regra de segurança de 3 dias seguidos com "médio" ou "forte".
- **Estoque:** dias restantes, passos de reposição, mensagens prontas ao médico e à farmácia (abre o WhatsApp ou copia o texto), "Chegou remédio" e "ajustar".
- **Notificações locais agendadas no iOS**, que chegam com o app fechado:
  - lembrete na hora de cada dose, respeitando o horário-limite do remédio;
  - repetições conforme a escada de insistência (repetir, alarme e desistir), nas próximas 36 h;
  - botões **Tomei** e **Adiar 10 min** na própria notificação;
  - avisos de check-in, de reposição e de renovação da instalação;
  - um último aviso, "Abra o Remédios", quando a agenda está para acabar.
- **Alarme em tela cheia dentro do app:** aparece ao abrir o app com dose atrasada ou ao tocar na notificação.
- **Assistente:** chamada real à API do Gemini (`generateContent`) com a sua chave, anexando os registros do período (7, 30 ou 90 dias). Modelo e prompt são editáveis.
- **Exportar e importar dados (.json):** importa o `dados.json` do app de Windows (remédios, planos, check-ins e configurações) ou um backup do próprio iPhone.

### Mudou em relação ao protótipo (para não ser fictício)
- "Sincronizar com o PC" **saiu**: não existe sincronização. Use Exportar/Importar.
- "Silenciar o bipe" saiu: o app não toca som próprio. O som é o da notificação do iOS.
- Sem remédios cadastrados, a tela Hoje mostra "Comece por aqui" (cadastrar ou importar).
- Dentro de Ajustes surgiram as seções "Instalação (Sideloadly)" e "Exportar/Importar".

### Precisa de implementação nativa (não existe nesta versão)
| Recurso | Por quê |
|---|---|
| Alarme em tela cheia **com o app fechado** (como a janela "por cima de tudo" do Windows) | O iOS só permite isso pelo AlarmKit (iOS 26), uma API em Swift sem plugin Capacitor oficial. Daria para escrever um plugin próprio depois. |
| Furar o Foco/Não Perturbe | Exige notificações "Time Sensitive" ou "Critical Alerts". Critical Alerts depende de aprovação da Apple; Time Sensitive precisa de um *entitlement* que provavelmente não funciona com Apple ID gratuito (não testado). |
| Chave da API no Keychain | Hoje fica em UserDefaults, protegida só pelo sandbox do app. O Keychain exigiria um plugin extra. |
| Sincronização automática com o Windows | Não implementada. |

## 3. Compilar no Codemagic (sem Mac)

O plano gratuito do Codemagic para contas pessoais dá 500 minutos de macOS M2 por mês, renovados no dia 1º. Uma compilação deste app deve levar uns 5 a 10 minutos.

1. **Crie um repositório no GitHub** (gratuito, pode ser privado) e envie o **conteúdo** da pasta `ios-app/` para a **raiz** do repositório. O `codemagic.yaml` precisa ficar na raiz. Pelo navegador: *Add file › Upload files*, arrastando as pastas.
2. Em **codemagic.io**, entre com o GitHub, clique em **Add application**, escolha o repositório e o tipo "Other". O Codemagic encontra o `codemagic.yaml` sozinho.
3. Clique em **Start new build** e escolha o workflow *Remédios iOS — IPA sem assinatura*.
4. Ao terminar, baixe **`Remedios-sem-assinatura.ipa`** em *Artifacts*. Se falhar, baixe o `xcodebuild.log` e me mande o trecho do erro.

O que o workflow faz: `npm install` → copia as fontes e empacota a ponte nativa → `npx cap add ios` (projeto Swift Package Manager, iOS 15+) → ícone → `npx cap sync ios` → `xcodebuild … CODE_SIGNING_ALLOWED=NO` → coloca o `App.app` em `Payload/` e compacta como `.ipa`.

> **Importante:** este workflow ainda **não foi executado**. Eu não tenho acesso ao seu GitHub nem ao Codemagic, e não existe macOS aqui. A primeira compilação é o teste real. Se algo falhar, os pontos mais prováveis são a resolução de pacotes Swift ou a geração do ícone (essa etapa não interrompe a compilação).

### O IPA sem assinatura funciona com o Sideloadly?
A Apple não aceita instalar um IPA sem assinatura num iPhone sem jailbreak. O que funciona é o Sideloadly **assinar o IPA no seu PC** com o seu Apple ID gratuito antes de instalar. Esse é o uso descrito pelo próprio Sideloadly e por outras fontes. Fica para confirmar no seu aparelho:
- o Sideloadly assina e instala sem erro;
- o recurso de notificação local funciona com perfil gratuito. Não depende de *push* nem de *entitlement* especial, então deve funcionar, mas teste com "Testar notificação".

## 4. Instalar no iPhone 11 pelo Windows

1. Instale o **iTunes da Apple** (instalador do site da Apple, não a versão da Microsoft Store) e o **Sideloadly** (sideloadly.io).
2. Ligue o iPhone no PC pelo cabo e toque em "Confiar" no iPhone.
3. No Sideloadly, arraste o `.ipa`, informe seu Apple ID (de preferência um secundário, só para isso) e clique em **Start**.
4. No iPhone: **Ajustes › Privacidade e Segurança › Modo de Desenvolvedor** → ligar e reiniciar (exigido desde o iOS 16).
5. **Ajustes › Geral › VPN e Gerenciamento de Dispositivos** → toque no seu Apple ID → **Confiar**.
6. Abra o Remédios, toque em **Ativar** na faixa "Lembretes desligados" e permita as notificações.
7. Em Ajustes do app, toque em **Testar notificação** e bloqueie a tela. A notificação deve chegar em cerca de 5 s.
8. Cadastre os remédios ou toque em **Importar** e escolha o `dados.json` do Windows. Para isso, copie o arquivo para o iCloud Drive ou mande para você mesmo e salve em Arquivos.

## 5. Assinatura gratuita: limites e risco para os lembretes

Limites da Apple para Apple ID gratuito (valem para qualquer ferramenta):
- **A instalação vale 7 dias.** Depois disso o app **não abre** até ser renovado.
- No máximo 3 apps instalados assim ao mesmo tempo, e 10 App IDs novos por semana.

**Como renovar:**
- **Manual:** a cada 6 dias, abra o Sideloadly e reinstale o mesmo `.ipa` com o mesmo Apple ID. Isso atualiza por cima e **mantém os dados**.
- **Automática:** na hora de instalar, marque a opção de renovação automática do Sideloadly. O programa renova sozinho, mas **só se o PC estiver ligado e o iPhone conectado** (Wi-Fi do iTunes ativado ou cabo) quando a assinatura estiver perto de vencer.
- Depois de renovar, toque em **Ajustes › Renovei hoje** no app. É isso que agenda o aviso "Renove amanhã".

**Riscos para os lembretes de remédio:**
1. **Assinatura vencida = app que não abre.** Não dá para marcar doses nem reagendar. Não está confirmado se as notificações já agendadas continuam chegando depois do vencimento. Trate a renovação como obrigatória e use os dois avisos do app (notificação no 6º dia e faixa vermelha na tela Hoje).
2. **O iOS guarda no máximo 64 notificações pendentes por app.** O app usa até 62, priorizando a primeira notificação de cada dose dos próximos 7 dias. As repetições cobrem as próximas 36 h. **Abrir o app pelo menos uma vez por dia** (marcando as doses, por exemplo) renova a agenda. A última notificação agendada é "Abra o Remédios", e Ajustes mostra até quando os lembretes estão cobertos.
3. **Foco/Não Perturbe** silencia os lembretes. Libere o Remédios nas exceções do Foco.
4. **Apagar o app apaga os dados.** Exporte uma cópia de vez em quando, em Ajustes › Exportar dados.
5. Sem o AlarmKit, uma dose esquecida gera **notificações repetidas**, não um alarme que toma a tela com o app fechado.

Para um app de medicamentos usado todos os dias, o caminho mais confiável a médio prazo é a conta Apple Developer paga (US$ 99/ano): a instalação vale 1 ano e dá para distribuir pelo TestFlight. O caminho gratuito funciona, mas depende de você manter a renovação semanal.

## 6. Testar sem iPhone

Abra `www/index.html` num navegador. A interface e todas as regras funcionam, salvando no `localStorage`. Notificações e compartilhamento nativo só existem no app instalado.
