[English](README.md) · [Español](README.es.md) · **Português**

# tutiendita

Sua loja online, funcionando na **sua própria conta da Cloudflare**, com um único botão. Sem saber programar, sem pagar hospedagem e sem colar chaves nem senhas. Site do projeto: [tutiendita.ar](https://tutiendita.ar).

**Loja online grátis e de código aberto para pequenos negócios**, na sua própria conta da Cloudflare (Workers e D1): catálogo com fotos (até 8 por produto e uma por opção, com R2 conectado), categorias e variações, carrinho que envia o pedido pelo WhatsApp (cada pedido fica guardado na seção Vendas do painel, onde você marca como pago e entregue), pagamento por transferência, páginas prontas para o Google (sitemap, Open Graph, schema.org Product) e um painel com passkeys. Sem comissão nas vendas e seus dados são seus.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ezequiel-corbalan/tutiendita)

## Como instalar

1. Clique no botão **Deploy to Cloudflare** aqui em cima.
2. Entre com a sua conta da Cloudflare (se você não tiver, pode criar uma grátis na hora).
3. Conecte a sua conta do GitHub ou do GitLab quando for pedido. É uma vez só: é lá que fica guardada a sua cópia da loja.
4. Escolha o nome da sua loja (o nome do Worker; se você já tiver outra tiendita na mesma conta, use um diferente) e clique em **Create and deploy**.
5. Espere alguns minutos. No final, abra o endereço que aparece (termina em `.workers.dev`): você vai ver **"Tu tiendita está lista"** (Sua tiendita está pronta).

Não é preciso digitar comandos nem configurar mais nada.

A loja pode ser exibida em espanhol, inglês ou português: você escolhe o idioma no primeiro acesso e pode mudar depois pelo painel (o padrão é espanhol, então as telas da loja começam em espanhol).

## O que é criado na sua conta

Tudo fica no seu nome; ninguém mais tem acesso.

| O quê | Para quê |
|---|---|
| Um **Worker** com o nome da sua loja | É a loja: as páginas que seus clientes veem e a API. |
| Um banco de dados **D1** com o nome da sua loja | Guarda seus produtos, categorias, pedidos e as fotos dos seus produtos (até 200). |
| Um repositório no seu GitHub ou GitLab | A sua cópia do código. Cada mudança que você enviar para lá é publicada sozinha. |

**Não precisa de cartão de crédito.** As fotos ficam no banco de dados. Se quiser mais, você pode ativar **"Fotos profissionais e sem limite"** depois, em Configurações no painel: usa R2, a Cloudflare pede um cartão para ativar e é grátis até 10 GB.

## Quanto custa

Para uma loja pequena, **nada**: cabe no plano gratuito da Cloudflare (Workers e D1 têm cotas gratuitas diárias e mensais). Se um dia a sua loja crescer muito, a Cloudflare avisa antes de cobrar; um plano pago nunca é ativado sozinho.

## Reivindique a sua loja

O endereço da sua loja é fácil de adivinhar, então na primeira vez que você entra pedimos um **código de reivindicação** que só você pode ver. Ele é gerado toda vez que a loja é publicada e aparece no log da etapa **Deploying**:

1. Entre no seu [painel da Cloudflare](https://dash.cloudflare.com/).
2. Vá em **Workers e Pages** (*Workers & Pages*) e abra a sua loja (o Worker com o nome que você escolheu ao instalar; se você não mudou, **tiendita**).
3. Na aba **Implantações** (*Deployments*), clique na mais recente e depois na etapa **Deploying** (implantando).
4. No log aparece o quadro **TU TIENDITA: CÓDIGO PARA RECLAMARLA** (em espanhol): copie o que vem depois de `CODIGO DE RECLAMO:`, com os hífens (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`); esse é o seu código de reivindicação.
5. Abra a sua loja, clique em **"Reclamar mi tienda"** (Reivindicar minha loja) e cole o código.

Depois você vai:

1. Criar a sua **passkey**: você entra com a digital, o rosto ou o PIN do seu celular ou computador. Não tem senha.
2. Guardar o seu **código de recuperação** (serve se você perder o dispositivo). Ele aparece uma vez só.
3. Escolher o **nome** da sua loja.
4. Informar o seu **WhatsApp**: é por lá que chegam os pedidos.
5. Se quiser, informar o seu **alias ou CBU** (os dados da sua conta bancária argentina) para receber por transferência e cadastrar o seu **primeiro produto**.

Se você fechar no meio, entre de novo com a sua passkey e continue de onde parou. Depois que a loja é reivindicada, o código de reivindicação não serve para mais nada.

## Se você perder o acesso

- **Você perdeu o dispositivo, mas tem o código de recuperação:** na tela de acesso clique em **"Perdí mi dispositivo"** (Perdi meu dispositivo), digite o código e crie uma passkey nova. O código continua valendo até você criá-la; depois damos um novo (o anterior deixa de valer) e você pode apagar as passkeys antigas em **"Acceso"** (Acesso).
- **Plano de emergência (você perdeu a passkey e também o código):** quem tem a conta da Cloudflare pode voltar a loja para "não reivindicada". Seus produtos, fotos e dados **não se perdem**.
  1. No painel da Cloudflare, vá em **Armazenamento e bancos de dados → D1** (*Storage & Databases → D1*), abra o banco que tem o nome da sua loja mais `-db` (se você não mudou o nome, **tiendita-db**) e entre no **Console**.
  2. Execute: `DELETE FROM acceso;`
  3. Publique a loja de novo para gerar um código de reivindicação novo: em **Workers e Pages →** sua loja **→ Implantações**, tente de novo a última compilação (ou envie qualquer mudança para o seu repositório).
  4. Procure o código novo no log da etapa **Deploying** da última implantação e reivindique a loja como na primeira vez (você pode fazer isso de outro endereço: sem dono, os endereços antigos não contam). As passkeys, sessões e endereços antigos são apagados sozinhos ao reivindicar.

## Lojas ativas

Uma vez por dia a sua loja avisa ao tutiendita.ar o seu endereço (nada mais: nem vendas, nem produtos, nem dados dos seus clientes) para contar quantas lojas estão ativas. Dá para desligar em **"Configuración"** (Configurações) no painel.

## Para quem sabe programar

Este repo é uma cópia autocontida da loja do monorepo do **tutiendita** (`apps/tiendita` mais os seus pacotes; site do projeto: https://tutiendita.ar): ele é gerado automaticamente e o ideal é fazer as mudanças lá. Mesmo assim, você pode modificá-lo como quiser.

```sh
npm ci                        # dependencias
npm run dev                   # migrações locais + Astro + wrangler em http://localhost:4321, loja já pronta
npm run build                 # build de producción (dist/)
npm test                      # todos los tests (node --test, build de prueba y Vitest); el CI los corre en cada PR
npm run deploy                # crea la D1 si falta + migraciones remotas + wrangler deploy (lo que corre Cloudflare)
```

- O Astro monta as páginas e o Hono atende `/api`, `/img`, `/feed`, `/.well-known` e `/mcp`, tudo em um único Worker.
- O domínio e os casos de uso ficam em `src/packages/core`; os adaptadores de D1 e R2 em `src/packages/infra-cloudflare`.
- O banco D1 tem o nome do Worker mais `-db` (`wrangler.jsonc`). Se você mudar o nome do Worker à mão, mude também o banco: assim duas lojas na mesma conta nunca compartilham dados. Não há bucket R2 até o dono ativar "Fotos profissionais e sem limite" em Configurações, que adiciona a linha `r2_buckets` ao seu `wrangler.jsonc`.
- Toda escrita exige uma sessão do dono (passkey) e o `Origin` da loja: sem sessão, `POST /api/products` responde 401. Com `npm run dev` em `localhost` a loja já sobe reivindicada, com o primeiro acesso feito e os produtos de exemplo, e o painel abre sem passkey (`src/dev/local-owner.ts`, nunca no build). Para testar a reivindicação de verdade, apague `.wrangler/state` e use `npm run build && npm run preview`; com a variável de build `CODIGO_DE_RECLAMO` você pode fixar o código (não é necessário em produção).
- O código de reivindicação é gerado por `integrations/claim-code.mjs` a cada `astro build`: ele o imprime e deixa no Worker só o SHA-256 dele.

## Licença

[FSL-1.1-MIT](LICENSE) (Functional Source License): você pode usar, copiar, modificar e fazer fork do código para o que quiser, inclusive ter a sua loja e vender com ela. A única coisa que não pode é oferecê-lo, ou algo derivado, como produto ou serviço comercial que concorra com o tutiendita. Cada versão vira MIT dois anos depois de publicada.
