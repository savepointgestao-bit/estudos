# Estudos (Edital em Dia): como gerar o APK

Esta pasta é o projeto do app pronto para virar um APK de Android. Ele funciona sem internet: fontes, ícone e todo o código já estão aqui dentro.

O que muda no app instalado em relação à página:

- **Notificações de verdade:** os lembretes com horário e o fim de cada pomodoro avisam no celular, mesmo com o app fechado.
- **Backup fora do app:** uma cópia por dia é salva em `Documentos/EditalEmDia` no celular (as 7 mais recentes). Em Ajustes, o botão "Salvar e enviar backup" manda o arquivo completo, com anexos, para o Drive, o WhatsApp ou o e-mail.
- **Botão voltar do Android:** fecha janelas e volta para a tela inicial antes de sair do app.

Existem dois caminhos para gerar o APK. O primeiro não exige instalar nada no computador.

---

## Caminho 1: pelo GitHub (recomendado, sem instalar nada)

O GitHub monta o APK na nuvem para você.

1. Crie uma conta gratuita em github.com, se ainda não tiver.
2. Clique em **New repository** (botão verde). Dê o nome `edital-em-dia`, deixe como **Private** e clique em **Create repository**.
3. Na página do repositório novo, clique em **uploading an existing file**.
4. Abra esta pasta no computador, selecione **tudo o que está dentro dela** e arraste para a página. Isso inclui a pasta `.github`, que pode estar oculta:
   - **Windows:** no Explorador de Arquivos, menu Exibir, marque "Itens ocultos".
   - **Mac:** aperte Cmd + Shift + ponto.
5. Clique em **Commit changes**.
6. Vá na aba **Actions**. Vai aparecer "Gerar APK" rodando (bolinha amarela). Leva uns 5 a 8 minutos.
7. Quando ficar verde, clique nele e, lá embaixo em **Artifacts**, baixe `estudos-apk`. Dentro do .zip está o `app-debug.apk`.

Se a pasta `.github` não subir, o passo 6 não acontece. Nesse caso, no repositório clique em **Add file → Create new file**, escreva o nome `.github/workflows/gerar-apk.yml`, cole o conteúdo do arquivo de mesmo nome desta pasta e salve.

## Caminho 2: no seu computador, com Android Studio

1. Instale o **Node.js** (versão LTS, em nodejs.org) e o **Android Studio** (developer.android.com/studio).
2. Abra um terminal nesta pasta e rode:
   ```
   npm install
   npm run android:criar
   npm run android:abrir
   ```
3. O Android Studio abre o projeto. Espere ele terminar de carregar (barra de baixo).
4. Menu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**. Quando terminar, clique em **locate** para achar o `app-debug.apk`.
   - Se o celular estiver ligado no computador por cabo (com a depuração USB ativa), você pode apertar o botão ▶ e o app instala direto.

## Instalar no celular

1. Passe o `app-debug.apk` para o celular (Drive, WhatsApp, cabo).
2. Toque no arquivo. O Android vai pedir para permitir **instalar apps desta fonte**. Permita e instale.
3. Na primeira vez que o app pedir, permita as **notificações**.

## Levar seus dados da página para o app

Os dados que você colocou na versão da página não passam sozinhos para o app.

1. Na página, abra **Ajustes → Copiar backup**.
2. Mande esse texto para o celular (por exemplo, para você mesma no WhatsApp ou no e-mail) e copie.
3. No app instalado, abra **Ajustes → Colar backup**, cole e toque em **Restaurar**.

Os anexos não entram nessa cópia em texto. Se tiver anexado arquivos, anexe de novo no app.

## Atualizar o app depois

Quando o app receber mudanças, troque o arquivo `www/index.html` (e o que mais tiver mudado) e gere o APK de novo:

- **Caminho 1 (GitHub):** suba o arquivo novo no repositório. O APK é gerado de novo sozinho.
- **Caminho 2 (Android Studio):** rode `npm run android:atualizar` e compile de novo.

Instalar o APK novo por cima mantém seus dados, desde que o `appId` em `capacitor.config.json` continue o mesmo.

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `www/` | O app em si (página, fontes e biblioteca de arrastar) |
| `assets/` | Ícone (avião pixel no céu) e tela de abertura |
| `capacitor.config.json` | Nome (Estudos) e identificador do app |
| `package.json` | Bibliotecas usadas (Capacitor 6 e plugins) |
| `scripts/permissoes.js` | Adiciona as permissões de notificação e de salvar o backup |
| `.github/workflows/gerar-apk.yml` | Receita que o GitHub usa para montar o APK |

O APK gerado é de teste (debug), para uso pessoal. Ele não serve para publicar na Play Store; para isso seria preciso uma assinatura própria, que dá para configurar depois.

---

## Site no GitHub Pages

O `index.html` da raiz só leva para `www/`, onde está o app de verdade. Com o Pages ligado em Settings > Pages > Deploy from a branch > `main` / `(root)`, o endereço é `https://SEU-USUARIO.github.io/estudos/`.

## Nuvem com PIN e palavra de segurança (Supabase)

Opcional. Sem configurar, o app funciona só no aparelho, como antes.

1. No Supabase, crie um projeto e rode `supabase/1-schema.sql` no SQL Editor.
2. Rode `supabase/2-definir-pin.sql` trocando o PIN e a palavra pelos seus.
3. Preencha `www/config.js` com a URL do projeto e a chave pública (anon ou publishable). Nunca coloque a `service_role`.

Depois disso o app pede PIN e palavra de segurança, e só abre se os dois estiverem certos (5 erros bloqueiam por 15 minutos). Os dados dos estudos ficam salvos na nuvem e sincronizam entre aparelhos. Anexos continuam só no aparelho.

Como o acesso funciona no dia a dia:

- Não há logout por tempo fixo. Cada vez que o app é usado, o prazo renova. Se ficar **48h sem ser aberto**, o PIN é pedido de novo.
- A **palavra de segurança fica salva no aparelho** depois da primeira vez. Nos próximos acessos só o PIN é pedido. O botão "Trocar palavra" (na tela do PIN) apaga a palavra salva e deixa digitar outra.
- O PIN nunca fica guardado no aparelho.
- Depois de 48h parado é preciso internet para digitar o PIN e voltar a usar o app.

Para atualizar o banco depois de mudanças no `1-schema.sql`, rode o arquivo inteiro de novo no SQL Editor. Ele é seguro para rodar mais de uma vez e não apaga o PIN, a palavra nem os dados.
