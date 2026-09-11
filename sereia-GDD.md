# Sereia do Tesouro - Documento Mestre

Ultima atualizacao: 2026-09-11

Este documento consolida o estado atual do projeto, a arquitetura tecnica, as regras de jogo/carteira, os pontos de seguranca e um brief comercial para usar em outra conversa sobre a criacao de uma agencia que vendera/licenciara o jogo para influenciadores.

Importante: este arquivo nao deve conter senhas, chaves de API, secrets, CPF completo de usuarios ou credenciais reais. Tudo que for sensivel deve ficar apenas em variaveis de ambiente no Render, Vercel, Supabase e Amplopay.

---

## 1. Resumo Executivo

Sereia do Tesouro e um jogo de cassino arcade mobile-first para web. A plataforma ja possui lobby, login, carteira Pix e historico reais. O gameplay ativo em 2026-09-11 virou um prototipo demo chamado internamente de Block Game: um puzzle 8x8 com pecas geometricas, drag and drop, clears de linhas/colunas e resgate visual apos progresso minimo.

O projeto ja esta funcional com:

- Frontend/jogo em Phaser 3 + Vite.
- Backend em FastAPI.
- Banco oficial em Supabase/Postgres.
- Comunicacao em tempo real via WebSocket.
- Login e cadastro proprios.
- Lobby mobile estilo casa de apostas.
- Carteira com saldo real do banco.
- Deposito Pix via Amplopay.
- Saque Pix via Amplopay.
- Historico e estatisticas reais no lobby.
- Aquisicao/tracking por influenciador e campanha.
- Painel admin para afiliados, campanhas e metricas.
- Rollover.
- Bonus de deposito.
- Conta admin/demo.
- Prototipo Block Game em modo demo, sem movimentar saldo real.
- Deploy atual: Vercel para frontend e Render para backend.

O produto ainda precisa de QA final em dispositivos reais, arte final proprietaria, fluxo completo de afiliados/influenciadores e revisao operacional antes de trafego pago.

Nota de produto: em 2026-09-11, o jogo classico de toque/flap e o runner em tres faixas foram pausados para teste de uma nova direcao. A experiencia ativa em `GameScene` agora e o Block Game em modo demo. Ele nao usa WebSocket financeiro, nao debita aposta e nao credita payout real. O objetivo desta fase e validar sensacao mobile, tamanho do tabuleiro, drag/drop, dificuldade e interesse do jogador antes de conectar ao backend financeiro.

---

## 2. Conceito do Produto

### Nome

Sereia do Tesouro.

### Nome visual no lobby

Sereia Palace.

### Categoria

Jogo de cassino arcade com mecanica de crash/cash out.

### Plataforma

Web mobile-first, rodando direto no navegador do celular. Nao depende de app instalado.

### Publico-alvo inicial

Mulheres de 20 a 35 anos, usuarias de celular, publico casual, sensivel a estetica, recompensa rapida, Pix e experiencia visual simples.

### Posicionamento

Um cassino gamificado de uma unica experiencia principal: a jogadora entra no lobby, deposita via Pix, escolhe a aposta e joga uma rodada curta com decisao de cash out. A proposta e parecer um jogo real e polido, com estetica de cassino asiatico/chines, mas mantendo um produto mais simples: apenas um jogo em destaque.

### Diferencial

- Um unico jogo proprietario em vez de catalogo generico.
- Identidade feminina/subaquatica.
- Cash out com tensao arcade.
- Deposito Pix integrado.
- Mobile como prioridade absoluta.
- Estrutura preparada para venda/licenciamento para influenciadores.

---

## 3. Stack Tecnica

### Frontend/Jogo

- Phaser 3.
- Vite.
- JavaScript ES Modules.
- Renderizacao canvas/WebGL via Phaser.
- DOM overlay para login, lobby e modais de carteira.

### Backend

- FastAPI.
- Python.
- WebSocket em `/ws/game`.
- Supabase Python client.
- Httpx para chamadas Amplopay.

### Banco

- Supabase/Postgres.
- Tabelas no schema `public`.
- RLS habilitado.
- Backend usa service role key via ambiente.

### Pagamentos

- Amplopay.
- Pix de entrada: `/gateway/pix/receive`.
- Pix de saida/saque: `/gateway/transfers`.
- Webhooks de pagamento e transferencia.

### Deploy

- Frontend: Vercel.
- Backend: Render.
- Banco: Supabase.
- Pagamento: Amplopay.

---

## 4. Estrutura Atual do Projeto

```text
BrunooS/
  game/
    index.html
    package.json
    vite.config.js
    src/
      main.js
      config.js
      services/
        api.js
      scenes/
        BootScene.js
        AuthScene.js
        LobbyScene.js
        AdminDashboardScene.js
        MenuScene.js
        GameScene.js
      block/
        BlockPuzzleLogic.js
      objects/
        Mermaid.js
        Obstacle.js
        Gem.js
        HUD.js
        ParticleEffects.js
      utils/
        SoundManager.js
    tests/
      blockPuzzleLogic.test.mjs

  backend/
    main.py
    requirements.txt
    db/
      database.py
      schema.sql
    routers/
      auth.py
      game.py
      tracking.py
      wallet.py
    services/
      auth.py
      casino.py
      provably_fair.py
      amplopay.py
      tracking.py
    tests/
      test_casino.py
      test_wallet_rules.py

  render.yaml
  sereia-GDD.md
```

---

## 5. Fluxo de Cenas Phaser

Fluxo atual:

```text
BootScene -> AuthScene -> LobbyScene -> MenuScene -> GameScene -> LobbyScene
```

### BootScene

Responsavel por iniciar o fluxo. Deve enviar o usuario para Auth ou Lobby dependendo da sessao valida.

### AuthScene

Tela de login/cadastro.

Login:

- Usuario.
- Senha.

Cadastro:

- Nome completo.
- Telefone celular.
- Email.
- CPF.
- Usuario.
- Senha.

Ao autenticar com sucesso:

- Salva token e usuario em `sessionStorage`.
- Entra no Lobby.

### LobbyScene

Tela principal pos-login.

Contem:

- Topbar com marca, usuario e role.
- Saldo disponivel real.
- Bonus ativo.
- Status de rollover.
- Botao Depositar.
- Botao Sacar Pix.
- Banner de promocao.
- Categorias visuais.
- Card unico do jogo.
- Stats reais.
- Historico real das ultimas rodadas.
- Aba Promocao.
- Aba Perfil.

### MenuScene

Tela de escolha de aposta.

Apostas permitidas atualmente:

- R$ 30.
- R$ 50.
- R$ 100.
- R$ 200.
- R$ 500.

O deposito minimo da plataforma continua sendo R$ 20.

O minimo de aposta da Sereia e R$ 30.

### GameScene

Cena principal do jogo.

Fluxo:

1. Recebe a aposta escolhida em `MenuScene`.
2. Inicia o prototipo Block Game em modo demo.
3. Cria tabuleiro 8x8.
4. Gera tres pecas disponiveis.
5. Jogador arrasta e solta pecas no tabuleiro.
6. Posicao valida ocupa celulas; posicao invalida retorna para a area inferior.
7. Linhas e colunas completas sao removidas com animacao.
8. Cada linha/coluna removida aumenta `totalClears`.
9. Ao chegar em 3 clears, o botao de resgate demo libera.
10. Se todas as tres pecas forem usadas, gera novo batch.
11. Se nenhuma das pecas restantes couber no tabuleiro, a rodada termina.
12. Resultado demo aparece e o jogador pode repetir ou voltar ao LobbyScene.

Observacao financeira: nesta fase, `GameScene` nao abre WebSocket, nao debita saldo real e nao registra rodada real. A aposta e o valor exibidos sao simulados para validar gameplay.

---

## 6. Gameplay Atual

### Core loop

```text
Escolher aposta -> abrir Block Game demo -> posicionar pecas -> limpar linhas/colunas -> resgatar demo ou perder por falta de movimentos -> lobby
```

### Controle

Estado ativo:

- Mobile: tocar, segurar e arrastar a peca.
- Desktop QA: mouse tambem funciona pelo mesmo sistema de pointer.
- A peca acompanha o dedo com offset vertical para nao ficar escondida.
- Durante o drag, o tabuleiro mostra preview de posicao valida ou invalida.
- Inputs ficam bloqueados durante animacao de clear, cashout pendente e estados finais.

### Tabuleiro

- 8 linhas x 8 colunas.
- Estado interno simples: `board[row][column]`.
- Cada celula pode estar vazia ou preenchida.
- Visual premium com fundo escuro, dourado, aqua e brilho discreto.

### Pecas

- Sempre existem tres pecas disponiveis por ciclo.
- O jogador pode usar em qualquer ordem.
- Quando uma peca e usada, ela sai da area inferior.
- Quando as tres sao usadas, novas tres pecas sao geradas.
- A geracao considera `difficultyTier` e garante que pelo menos uma peca do batch tenha movimento valido sempre que possivel.

Pecas atuais:

- 1 bloco.
- 2 horizontal.
- 2 vertical.
- 3 horizontal.
- 3 vertical.
- Quadrado 2x2.
- L pequeno.
- 4 horizontal.
- 4 vertical.
- 3x2.
- T.
- Z.
- Z invertido.
- L maior.
- Linha de 5.
- Plus.
- Formas maiores de tier 4.

### Clears

- Linha completa remove as 8 celulas da linha.
- Coluna completa remove as 8 celulas da coluna.
- Linha + coluna na mesma jogada conta como +2 clears.
- Multiplo clear exibe feedback visual.

### Tesouros

Tesouros e diamantes do runner/flap antigo estao pausados. No Block Game, os blocos e clears assumem o papel visual de recompensa.

### Tubarao perseguidor

O tubarao perseguidor existia no runner em tres faixas, mas esta pausado junto com esse modo. A experiencia ativa nao usa `sharkDistance`.

### Valor demo

No prototipo Block Game:

- Valor inicial = aposta x 1.00.
- Cada clear aumenta o valor visual.
- Cada jogada aumenta levemente o valor visual.
- Limite demo atual: `maxDemoMultiplier = 8`.
- Nenhum valor e liquidado no backend nesta fase.

### Cash out

- Botao existe desde o inicio, mas fica bloqueado.
- Libera apos 3 linhas/colunas completas.
- Depois de liberado, o jogador pode resgatar demo ou continuar.
- Cashout real deve ser conectado ao backend somente apos aprovacao da gameplay.

### Derrotas

Derrota acontece somente quando nenhuma das pecas disponiveis pode ser posicionada em nenhuma celula valida do tabuleiro.

Regra essencial: se uma peca nao cabe, mas outra das tres cabe, o jogo continua.

---

## 7. Progressao de Dificuldade

### Usuario comum

No Block Game, a dificuldade aumenta por `difficultyTier`, calculado a partir de `totalClears` e quantidade de jogadas.

Tiers:

- Tier 1: pecas simples, como 1 bloco, 2H, 2V, 3H, 3V e 2x2.
- Tier 2: adiciona L pequeno, pecas de 4 blocos e 3x2.
- Tier 3: adiciona T, Z, L maior e linhas de 5.
- Tier 4: adiciona formas maiores e menos flexiveis.

Configuracao central:

```text
BLOCK_GAME_CONFIG.difficulty = {
  easyUntil: 3,
  mediumUntil: 6,
  hardUntil: 9
}
```

O jogo nao deve gerar pecas impossiveis de proposito. A geracao tenta entregar um batch com pelo menos uma jogada valida sempre que houver espaco possivel.

### Admin/demo

Nesta fase, todos os usuarios jogam o Block Game em modo demo. Admin continua util para teste operacional da plataforma, mas o prototipo nao diferencia velocidade, payout ou saldo por role.

---

## 8. Motor de Cassino

### Arquivo principal

`backend/services/casino.py`

### RTP alvo

RTP teorico: aproximadamente 95%.

House edge:

```text
HOUSE_EDGE = 0.05
```

### Provably fair

A rodada usa:

- `server_seed` gerado pelo backend.
- `server_seed_hash` enviado ao cliente antes/depois do inicio.
- HMAC para gerar crash point.
- `round_id` como parte da entropia.

### Crash point

O servidor gera o ponto de crash antes da rodada.

Regras:

- Aproximadamente 5% das rodadas podem crashar em 1.00x.
- Se nao for crash instantaneo, crash minimo fica em 1.01x.
- Distribuicao favorece muitos resultados baixos e alguns resultados muito altos, comportamento esperado de crash game.

### Validacao de payout

Cash out so paga se:

```text
cash_out_mult <= crash_point
```

O payout e:

```text
payout = bet * cash_out_mult
```

---

## 9. WebSocket Autorizado

Endpoint:

```text
/ws/game
```

Status atual: o WebSocket continua implementado no backend para o modelo de rodada cashout/crash anterior, mas o prototipo Block Game de fase 1 nao usa esse endpoint. A integracao financeira do Block Game deve ser feita em uma fase posterior, com backend autoritativo para aposta, saldo, geracao/seed de rodada, cashout e liquidacao.

### Mensagens do cliente

`start_round`

```json
{
  "action": "start_round",
  "bet": 30,
  "token": "SESSION_TOKEN"
}
```

`begin_play`

```json
{
  "action": "begin_play",
  "round_id": "uuid"
}
```

`cash_out`

```json
{
  "action": "cash_out",
  "round_id": "uuid",
  "client_mult": 2.5
}
```

`death`

```json
{
  "action": "death",
  "round_id": "uuid",
  "client_mult": 1.7
}
```

`ping`

```json
{
  "action": "ping"
}
```

### Mensagens do servidor

`round_started`

```json
{
  "type": "round_started",
  "round_id": "uuid",
  "server_seed_hash": "hash",
  "balance": 80,
  "demo_mode": false
}
```

Observacao: neste momento a rodada existe no banco, mas a aposta ainda nao foi debitada e o relogio de crash ainda nao comecou.

`play_started`

```json
{
  "type": "play_started",
  "round_id": "uuid",
  "balance": 70,
  "server_time": 1788530000
}
```

`round_canceled`

```json
{
  "type": "round_canceled",
  "round_id": "uuid",
  "message": "Rodada cancelada por demora ao iniciar."
}
```

`cash_out_result`

```json
{
  "type": "cash_out_result",
  "success": true,
  "payout": 50,
  "balance": 130,
  "multiplier": 2.5,
  "client_multiplier": 2.51,
  "crash_point": 3.2,
  "server_seed": "seed"
}
```

`round_crashed`

```json
{
  "type": "round_crashed",
  "round_id": "uuid",
  "multiplier": 1.84,
  "crash_point": 1.84,
  "server_seed": "seed"
}
```

`death_registered`

```json
{
  "type": "death_registered",
  "crash_point": 2.4,
  "server_seed": "seed"
}
```

`error`

```json
{
  "type": "error",
  "message": "Saldo insuficiente"
}
```

### Protecoes atuais

- Token de sessao e validado no backend.
- Aposta e validada no backend.
- Saldo e debitado no backend somente no `begin_play`, imediatamente antes da rodada ativa comecar.
- Multiplicador do cash out e calculado pelo servidor.
- Crash point e gerado no servidor.
- Cliente nao decide payout.
- Cliente nao decide saldo.
- Idempotency key evita credito/debito duplicado por rodada.

### Risco tecnico restante

A colisao com obstaculo ainda e reportada pelo cliente com a mensagem `death`. Isso e aceitavel para MVP/teste, mas nao e totalmente resistente a cliente adulterado. Antes de escalar trafego, idealmente implementar uma camada adicional:

- Simulacao deterministica de obstaculos com seed server-side.
- Envio de inputs do jogador para o servidor.
- Validacao/replay server-side simplificado.
- Ou limitar o ganho por rodada enquanto essa camada nao estiver finalizada.

O dinheiro e protegido pelo servidor, mas a habilidade/colisao ainda nao e 100% autoritativa.

---

## 10. Autenticacao

### Endpoints

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
GET  /api/lobby/me
```

### Cadastro

Campos:

- Telefone.
- Email.
- Usuario.
- Nome completo.
- CPF/CNPJ, hoje usando CPF no cliente.
- Senha.

Validacoes:

- Usuario unico.
- Email unico.
- Documento unico.
- CPF com 11 digitos.
- Senha com minimo 6 caracteres.

### Login

Campos:

- Usuario.
- Senha.

### Senha

Hash atual:

- PBKDF2 SHA-256.
- 210.000 iteracoes.
- Salt aleatorio.

### Token

Token proprio HMAC:

- Payload com user id, username, role, iat e exp.
- Assinatura HMAC SHA-256.
- TTL default: 4 horas.

### Sessao no frontend

O cliente usa `sessionStorage`, nao `localStorage`.

Regras:

- Sessao expira por inatividade em 30 minutos.
- Sessao expira totalmente em 4 horas.
- Ao fechar navegador, `sessionStorage` tende a ser perdido.
- Ao voltar para a aba, o jogo checa se a sessao ainda e valida.

---

## 11. Lobby e UX

### Estado atual

Lobby esta orientado a celular e usa visual inspirado em casas de apostas asiaticas/chinesas:

- Fundo escuro vermelho/preto.
- Destaques dourados.
- Card grande de saldo.
- Banner promocional.
- Navegacao inferior fixa.
- Abas: Lobby, Promocao, Perfil.
- Card unico do jogo.
- Historico real.
- Stats reais.

### Abas

Lobby:

- Saldo.
- Bonus.
- Rollover.
- Depositar.
- Sacar Pix.
- Card do jogo.
- Estatisticas.
- Ultimas rodadas.

Promocao:

- Banner "recarregue e ganhe".
- Bonus de 100% para depositos a partir de R$ 100.
- Explicacao de rollover.

Perfil:

- Usuario.
- Role.
- Email.
- Telefone.
- Nome.
- Documento mascarado.
- Saldo.
- Bonus.
- Rollover pendente.
- Botao atualizar.
- Botao sair.

### Pontos de melhoria visual

- Trocar emojis por sprites reais.
- Melhorar logo/marca.
- Criar banner promocional com arte bitmap final.
- Criar icones consistentes para lobby.
- Adicionar feedback visual para Pix pago.
- Adicionar skeleton loading mais refinado.
- Adicionar tela de erro offline/reconexao.

---

## 11A. Aquisicao e Tracking

Modulo implementado para influenciadores e campanhas.

Fluxo:

1. Admin cria influenciador em `Painel Admin`.
2. Admin cria campanha com `referral_code`, custo de midia e periodo.
3. O painel gera link como `https://frontend.com/?ref=JULIANA`.
4. Quando visitante abre o link, o frontend chama `POST /api/tracking/click`.
5. Backend normaliza e valida o referral code.
6. Backend registra clique em `acquisition_clicks`.
7. Backend retorna `click_id` e `tracking_token` assinado.
8. Frontend guarda first-touch por ate 30 dias em `localStorage`.
9. Se visitante cadastrar, o cadastro envia click/token.
10. Backend valida token e atribui o usuario a campanha.
11. Depositos futuros do usuario recebem `payment_intents.campaign_id`.
12. Admin acompanha metricas derivadas das tabelas reais.

Regras:

- First-touch: primeiro referral valido e mantido.
- Token de autenticacao continua em `sessionStorage`.
- Tracking de aquisicao usa `localStorage`.
- Referral invalido nao quebra o site.
- Usuario ja atribuido nao deve trocar campanha automaticamente.
- `campaign_id` financeiro nunca vem do frontend; o backend deriva pelo usuario.

Metricas atuais:

- Cliques totais.
- Cliques unicos.
- Cadastros.
- Depositantes.
- FTDs.
- Valor total depositado.
- Numero de depositos.
- Total apostado.
- Total de payouts.
- GGR.
- Custo de campanha.
- CAC.
- Conversoes.
- Resultado bruto da midia.

---

## 12. Carteira, Deposito, Saque e Rollover

### Principio central

O saldo que o jogador ve no jogo e o saldo bruto creditado para ele, nao o valor liquido que cai na Amplopay depois de taxas.

Exemplo:

- Usuario paga Pix de R$ 20.
- Amplopay pode mostrar liquido menor por taxa.
- O jogo credita R$ 20 ao usuario quando o pagamento e confirmado.
- A taxa e custo operacional da casa/operador, nao desconto no saldo do jogador.

### Deposito minimo

R$ 20.

### Saque minimo

R$ 20.

### Bonus de deposito

Regra atual:

- Depositos abaixo de R$ 100: sem bonus.
- Depositos a partir de R$ 100: bonus de 100%.

Exemplos:

Deposito de R$ 20:

- Usuario paga R$ 20.
- Saldo creditado: R$ 20.
- Bonus: R$ 0.
- Rollover exigido: R$ 40.

Deposito de R$ 100:

- Usuario paga R$ 100.
- Bonus: R$ 100.
- Saldo creditado: R$ 200.
- Rollover exigido: R$ 400.

Deposito de R$ 250:

- Usuario paga R$ 250.
- Bonus: R$ 250.
- Saldo creditado: R$ 500.
- Rollover exigido: R$ 1.000.

### Rollover

Regra atual:

```text
rollover_required += credito_total * 2
```

Credito total = deposito + bonus.

O progresso do rollover aumenta com apostas feitas:

```text
rollover_progress += valor_da_aposta
```

O saque so e liberado quando:

```text
rollover_progress >= rollover_required
```

### Como a aposta afeta saldo

Ao iniciar uma rodada:

1. Backend valida usuario e saldo.
2. Backend debita a aposta.
3. Backend registra transacao `bet`.
4. Rollover avanca pelo valor apostado.
5. Se perder, a aposta ja ficou debitada.
6. Se ganhar, backend credita payout.

### Para onde vai o dinheiro quando usuario perde

Tecnicamente:

- O dinheiro real do deposito fica no ecossistema da Amplopay/conta do operador.
- No banco do jogo, a perda aparece como diferenca entre `bet` e `payout`.
- A receita bruta de jogo e calculada como:

```text
GGR = total_bets - total_payouts
```

Esse valor nao "volta" para Amplopay automaticamente. Ele ja esta representado como saldo operacional disponivel, respeitando passivos de jogadores, saques pendentes e settlements.

### Saque do usuario

Fluxo:

1. Usuario solicita saque no lobby.
2. Backend verifica rollover.
3. Backend verifica saldo.
4. Backend cria `withdrawal_request`.
5. Backend segura o saldo com transacao `withdrawal_hold`.
6. Se provider for Amplopay, backend cria transferencia Pix.
7. Webhook da Amplopay atualiza status.
8. Se falhar, backend estorna com `withdrawal_refund`.

### Settlement do operador/admin

Existe endpoint admin para solicitar settlement:

```text
POST /api/wallet/admin/operator-settlements
```

Existe relatorio:

```text
GET /api/wallet/admin/operator-report
```

O relatorio calcula:

- Depositos confirmados.
- Total apostado.
- Total pago.
- GGR.
- Saques pendentes.
- Settlements reservados.
- Saldo dos jogadores ainda devido.
- Rollover agregado.
- Disponivel para settlement.

Formula de seguranca:

```text
available_for_settlement = min(available_cash_gross, available_ggr)
```

Isso evita sacar mais do que a operacao teoricamente pode cobrir.

---

## 13. Integracao Amplopay

### Service

`backend/services/amplopay.py`

### Variaveis de ambiente necessarias

No Render:

```text
PAYMENT_PROVIDER=amplopay
AMPLOPAY_BASE_URL=https://app.amplopay.com/api/v1
AMPLOPAY_PUBLIC_KEY=...
AMPLOPAY_SECRET_KEY=...
AMPLOPAY_REQUIRE_WEBHOOK_TOKEN=true
BACKEND_PUBLIC_URL=https://seu-backend.onrender.com
```

Nunca colocar chaves reais no frontend, GitHub ou documento publico.

### Deposito Pix

Endpoint interno do jogo:

```text
POST /api/wallet/deposit-intents
```

Backend chama Amplopay:

```text
POST /gateway/pix/receive
```

Payload enviado inclui:

- Identifier interno do payment intent.
- Amount bruto.
- Cliente: nome, email, telefone, documento.
- Produto: "Creditos Sereia Palace".
- Callback URL.

O jogo recebe:

- Pix copia e cola.
- QR code se retornado pela Amplopay.
- Status pending.

Credito ao jogador so acontece apos webhook pago.

### Webhook de pagamento

Endpoint:

```text
POST /api/wallet/webhooks/amplopay/payment
```

Evento pago esperado:

```text
TRANSACTION_PAID
```

Ao receber pagamento:

1. Localiza payment intent pelo provider id ou identifier.
2. Valida token de webhook.
3. Valida valor.
4. Confirma deposito.
5. Credita saldo bruto + bonus se aplicavel.
6. Atualiza rollover.

### Saque Pix

Endpoint interno:

```text
POST /api/wallet/withdrawals
```

Backend chama Amplopay:

```text
POST /gateway/transfers
```

Payload inclui:

- Valor.
- Identifier da withdrawal request.
- Chave Pix.
- Tipo da chave.
- Titular.
- Documento.
- IP.
- Callback URL.

### Webhook de transferencia

Endpoint:

```text
POST /api/wallet/webhooks/amplopay/transfer
```

Eventos:

- `TRANSFER_COMPLETED`: marca como pago.
- `TRANSFER_FAILED`: marca como falhou e estorna saldo se for saque de usuario.

---

## 14. Modelo de Dados

Arquivo de schema:

```text
backend/db/schema.sql
```

### users

Guarda usuarios, permissao e carteira.

Campos principais:

- `id`
- `phone`
- `email`
- `username`
- `legal_name`
- `document`
- `document_type`
- `password_hash`
- `role`
- `permissions`
- `balance`
- `bonus_balance`
- `rollover_required`
- `rollover_progress`
- `acquisition_campaign_id`
- `acquisition_click_id`
- `referral_code`
- `attributed_at`
- `created_at`
- `updated_at`

### affiliates

Guarda influenciadores/parceiros.

Campos principais:

- `id`
- `name`
- `handle`
- `contact`
- `status`
- `notes`
- `created_at`
- `updated_at`

### campaigns

Guarda campanhas de aquisicao e codigos de referral.

Campos principais:

- `id`
- `affiliate_id`
- `name`
- `referral_code`
- `status`
- `media_cost`
- `starts_at`
- `ends_at`
- `metadata`
- `created_at`
- `updated_at`

### acquisition_clicks

Guarda cliques de campanha sem IP bruto ou dados pessoais.

Campos principais:

- `id`
- `campaign_id`
- `visitor_id`
- `landing_path`
- `referrer_url`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `created_at`

### rounds

Guarda rodadas do jogo.

Campos principais:

- `round_id`
- `user_id`
- `bet`
- `crash_point`
- `cash_out_at`
- `payout`
- `server_seed`
- `server_seed_hash`
- `status`
- `created_at`

### wallet_transactions

Ledger da carteira.

Tipos atuais esperados:

- `deposit`
- `bet`
- `bet_refund`
- `payout`
- `withdrawal_hold`
- `withdrawal_refund`

Campos:

- `id`
- `user_id`
- `transaction_type`
- `amount`
- `balance_after`
- `status`
- `reference_type`
- `reference_id`
- `idempotency_key`
- `metadata`
- `created_at`

### payment_intents

Depositos Pix.

Campos:

- `id`
- `user_id`
- `provider`
- `provider_payment_id`
- `amount`
- `status`
- `pix_qr_code`
- `pix_copy_paste`
- `campaign_id`
- `expires_at`
- `metadata`
- `created_at`
- `updated_at`

### withdrawal_requests

Saques de usuarios.

Campos:

- `id`
- `user_id`
- `amount`
- `pix_key`
- `pix_key_type`
- `owner_name`
- `owner_document`
- `owner_document_type`
- `status`
- `provider_transfer_id`
- `reviewed_by`
- `metadata`
- `created_at`
- `updated_at`

### operator_settlements

Saques/settlements do operador/admin.

Campos:

- `id`
- `requested_by`
- `amount`
- `pix_key`
- `pix_key_type`
- `owner_name`
- `owner_document`
- `owner_document_type`
- `provider_transfer_id`
- `status`
- `metadata`
- `paid_at`
- `created_at`
- `updated_at`

### RPC de carteira

Funcao:

```text
public.adjust_wallet_balance
```

Objetivo:

- Atualizar saldo com lock transacional.
- Evitar saldo negativo.
- Registrar transacao.
- Respeitar idempotency key.
- Atualizar bonus.
- Atualizar rollover.

Essa funcao e essencial para seguranca financeira.

---

## 15. Endpoints HTTP

### Health

```text
GET /health
GET /health/db
```

### Auth

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
GET  /api/lobby/me
```

### Tracking publico

```text
POST /api/tracking/click
```

### Wallet usuario

```text
GET  /api/wallet/me
POST /api/wallet/deposit-intents
POST /api/wallet/deposit-intents/{intent_id}/sandbox-confirm
POST /api/wallet/withdrawals
```

### Wallet webhooks

```text
POST /api/wallet/webhooks/amplopay/payment
POST /api/wallet/webhooks/amplopay/transfer
```

### Admin

```text
GET   /api/admin/affiliates
POST  /api/admin/affiliates
PATCH /api/admin/affiliates/{affiliate_id}
GET   /api/admin/campaigns
POST  /api/admin/campaigns
PATCH /api/admin/campaigns/{campaign_id}
GET   /api/admin/acquisition/overview
GET   /api/admin/acquisition/campaigns
GET   /api/admin/acquisition/campaigns/{campaign_id}
GET  /api/wallet/admin/operator-report
POST /api/wallet/admin/operator-settlements
```

### Game

```text
WS /ws/game
```

---

## 16. Variaveis de Ambiente

### Backend - Render

Obrigatorias para producao:

```text
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
AUTH_SECRET=...
AUTH_TOKEN_TTL_SECONDS=14400
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
ADMIN_EMAIL=...
ADMIN_PHONE=...
ALLOWED_ORIGINS=https://seu-front.vercel.app
BACKEND_PUBLIC_URL=https://seu-backend.onrender.com
PAYMENT_PROVIDER=amplopay
AMPLOPAY_BASE_URL=https://app.amplopay.com/api/v1
AMPLOPAY_PUBLIC_KEY=...
AMPLOPAY_SECRET_KEY=...
AMPLOPAY_REQUIRE_WEBHOOK_TOKEN=true
REQUIRE_WALLET_LEDGER=true
```

Recomendacao:

- Em teste pode usar `REQUIRE_WALLET_LEDGER=false`.
- Para producao, usar `REQUIRE_WALLET_LEDGER=true` depois de confirmar que a RPC do Supabase esta funcionando.

### Frontend - Vercel

Obrigatorias:

```text
VITE_API_URL=https://seu-backend.onrender.com
VITE_WS_URL=wss://seu-backend.onrender.com/ws/game
```

Observacao:

- Nao colocar nenhuma chave secreta no Vercel frontend.
- Variaveis `VITE_*` ficam expostas no bundle do navegador.

---

## 17. Seguranca Atual

### Pontos implementados

- Service role do Supabase fica apenas no backend.
- RLS habilitado nas tabelas.
- Password hash com PBKDF2 SHA-256.
- Token HMAC com expiracao.
- Sessao no cliente usa `sessionStorage`.
- Expiracao por inatividade.
- Limite simples de tentativas de login/cadastro por IP em memoria.
- Headers de seguranca:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `X-Frame-Options: DENY`
  - `Permissions-Policy` restritivo.
- Cache no-store para auth/wallet.
- Webhook Amplopay com token validado por hash.
- Validacao de valor recebido no webhook.
- Redacao de campos sensiveis em payloads salvos.
- Idempotency key em depositos, apostas, payouts e refunds.
- Cash out validado pelo servidor.
- Saldo alterado pelo servidor.
- Apostas permitidas em whitelist.

### Pontos que exigem cuidado

- Nunca commitar `.env`.
- Nunca colar secrets em chat publico.
- Rotacionar secrets se forem expostos.
- Manter `SUPABASE_SECRET_KEY` apenas no backend.
- `AUTH_SECRET` deve ser forte e diferente da chave Supabase em producao.
- `ALLOW_VERCEL_PREVIEWS=true` permite qualquer preview Vercel por regex. Para producao fechada, considerar `false`.
- Rate limit atual e em memoria. Em producao com trafego, usar Redis/Upstash ou outro storage compartilhado.
- Block Game ainda esta em demo. Antes de dinheiro real, backend deve validar aposta, saldo, seed da rodada, pecas geradas, movimentos e cashout.
- Admin deve ser tratado como conta operacional/demo. Antes de producao aberta, revisar se admin pode ou nao solicitar saque comum.
- Criar alertas para picos de saque, chargeback, erro de webhook e saldo provider baixo.

### Checklist de seguranca antes de producao

- [ ] Rotacionar todas as chaves que ja foram compartilhadas em chat, print ou ambiente inseguro.
- [ ] Confirmar `.env` ignorado pelo Git.
- [ ] Confirmar que Vercel nao possui secrets de backend.
- [ ] Confirmar que Render tem apenas variaveis necessarias.
- [ ] Confirmar `AUTH_SECRET` forte.
- [ ] Confirmar `REQUIRE_WALLET_LEDGER=true`.
- [ ] Confirmar RLS habilitado e service role funcionando.
- [ ] Testar webhook com token invalido.
- [ ] Testar webhook com valor divergente.
- [ ] Testar deposito duplicado.
- [ ] Testar payout duplicado.
- [ ] Testar saque com saldo insuficiente.
- [ ] Testar saque com rollover pendente.
- [ ] Testar falha de transferencia e refund.
- [ ] Implementar logs sem CPF completo/secrets.

---

## 18. QA Mobile

Prioridade absoluta: celular.

### Dispositivos minimos para testar

- iPhone Safari.
- iPhone Chrome.
- Android Chrome.
- Android Samsung Internet, se possivel.

### Cenarios

Auth:

- Login.
- Cadastro.
- Foco no campo senha com teclado aberto.
- Cadastro com CPF invalido.
- Usuario duplicado.
- Email duplicado.
- Sessao expirada.
- Fechar navegador e abrir novamente.

Lobby:

- Carregamento em 4G/5G.
- Saldo correto.
- Bonus correto.
- Rollover correto.
- Historico real apos rodadas.
- Historico e stats devem ignorar rodadas `ready/canceled` que nao chegaram a comecar.
- Botao depositar.
- Modal Pix.
- Aba Promocao.
- Aba Perfil.
- Logout.

Deposito:

- Gerar Pix de R$ 20.
- Gerar Pix de R$ 100.
- Confirmar webhook pago.
- Ver saldo subir pelo valor bruto.
- Confirmar bonus apenas a partir de R$ 100.
- Confirmar rollover 2x sobre credito total.

Saque:

- Tentar sacar com rollover pendente.
- Tentar sacar abaixo de R$ 20.
- Tentar sacar com saldo insuficiente.
- Solicitar saque valido.
- Simular webhook de sucesso.
- Simular webhook de falha e refund.

Jogo:

- Tela cheia em celular.
- Drag/drop responsivo.
- Sem zoom quebrado.
- Sem scroll indesejado.
- Tabuleiro ocupa bem a largura em 375x812, 390x844, 393x852 e 430x932.
- Pecas nao ficam escondidas atras do dedo.
- Preview valido/invalido aparece durante o drag.
- Peca invalida retorna suavemente.
- Linha completa desaparece.
- Coluna completa desaparece.
- Linha + coluna simultaneas contam +2.
- Resgate demo libera apos 3 clears.
- Game over so acontece quando nenhuma peca restante couber.
- Nenhum saldo real muda no prototipo demo.

Performance:

- 60fps alvo.
- Sem travar ao abrir modal.
- Sem vazamento de DOM ao trocar cenas.
- Sem crescimento infinito de objetos Phaser.
- Testar depois de 20 rodadas seguidas.

---

## 19. Status Atual de Implementacao

### Completo ou funcional

- Prototipo Block Game demo jogavel.
- Tabuleiro 8x8.
- Tres pecas por ciclo.
- Drag/drop com offset mobile.
- Preview de placement valido/invalido.
- Clear de linha, coluna e linha+coluna.
- Desbloqueio de resgate demo apos 3 clears.
- Game over quando nenhuma das pecas restantes cabe.
- Testes unitarios das regras do puzzle.
- Fluxo de cenas.
- Login/cadastro.
- Lobby real.
- Perfil basico.
- Promocao/bonus.
- Historico real.
- Stats reais.
- Supabase como banco.
- Schema de wallet.
- RPC transacional de carteira.
- Deposito Amplopay gerando Pix.
- Webhook de deposito.
- Saque Amplopay.
- Webhook de transferencia.
- Rollover.
- Bonus de deposito.
- Admin/demo.
- Tracking first-touch por referral.
- Cadastro atribuido a campanha.
- Depositos atribuidos a campanha.
- Painel admin de aquisicao.
- CRUD basico de influenciadores e campanhas.
- Exportacao CSV de campanhas.
- Testes basicos de casino, wallet rules e tracking.

### Em polimento

- Qualidade visual do lobby/auth em todos os celulares.
- Qualidade visual final do Block Game.
- Sensacao do drag/drop em iPhone e Android reais.
- Balanceamento de dificuldade do puzzle.
- Feedback visual de combo e game over.
- Adapter backend para transformar o Block Game demo em rodada financeira real.

### Falta para produto final

- Arte final proprietaria.
- Spritesheet da sereia.
- Sprites de obstaculos.
- Sprite/animacao de diamantes.
- Particulas finais.
- Audio final.
- Logo final.
- Banners finais.
- Backend autoritativo especifico para Block Game.
- Persistencia de rodada Block Game.
- Liquidacao financeira real do cashout Block Game.
- Painel admin visual.
- Dashboard financeiro.
- Dashboard para influenciador.
- Cupons/codigos de campanha.
- Relatorio por influenciador.
- Sistema de whitelist/limites operacionais.
- Monitoramento e alertas.
- Testes E2E automatizados.
- Anti-cheat/validacao server-side para movimentos do Block Game.

---

## 20. Brief Comercial para Agencia

### Ideia da agencia

Criar uma agencia/plataforma que oferece jogos de cassino web mobile para influenciadores operarem campanhas, comunidades ou marcas proprias. O influenciador divulga um link exclusivo, o publico acessa no celular, cria conta, deposita via Pix e joga. A agencia cuida da tecnologia, operacao, customizacao visual e relatorios.

### Produto inicial vendido

Sereia do Tesouro / Sereia Palace.

Um cassino arcade de uma unica experiencia, com:

- Login/cadastro.
- Pix.
- Lobby proprio.
- Saldo.
- Bonus.
- Rollover.
- Prototipo Block Game demo.
- Backend financeiro pronto para futura liquidacao real.
- Historico.
- Perfil.
- Saque Pix.

### Publico comprador

- Influenciadoras.
- Streamers.
- Criadoras de conteudo adulto/entretenimento.
- Comunidades fechadas.
- Donos de trafego.
- Afiliados com audiencia forte em mobile.

### Proposta de valor para influenciador

- Produto pronto para divulgar.
- Link direto sem instalar app.
- Visual customizavel com identidade do influenciador.
- Pix integrado.
- Experiencia rapida e simples para audiencia.
- Conta demo para demonstracao em live/story.
- Relatorio de performance.
- Possibilidade futura de comissao/participacao por resultado.

### O que pode ser customizado no futuro

- Nome do lobby.
- Logo.
- Cores.
- Banner de promocao.
- Skin da sereia.
- Obstaculos tematicos.
- Bonus de campanha.
- Codigo de convite.
- Landing page curta.
- URL personalizada.

### Frases comerciais base

- "Um jogo exclusivo de cassino mobile para sua comunidade."
- "Seu publico entra pelo link, deposita via Pix e joga em segundos."
- "Experiencia gamificada, visual proprietario e painel de performance."
- "Modelo pronto para campanhas com influenciadores."
- "Uma unica vitrine, um unico jogo, foco total em conversao mobile."

### Evitar promessas perigosas

Nao prometer:

- Ganho garantido.
- Renda certa.
- Lucro facil para usuario final.
- Chance manipulada individualmente.
- Resultado financeiro sem risco.

Comunicar como entretenimento 18+ com risco de perda.

### Funcionalidades de agencia ainda nao implementadas

- Dashboard por influenciador.
- Revenue share automatico.
- Comissoes.
- Relatorio de LTV, FTD, deposito, saque e GGR por campanha.
- Multi-tenant/white-label real.
- Dominios separados por influenciador.
- Painel para criar promocao.
- Sistema de cupom.
- Controle de limite por campanha.

### MVP de agencia recomendado

Fase 1:

- Um unico jogo.
- Um unico operador.
- Links UTM por influenciador.
- Relatorio admin interno.
- Visual padrao Sereia Palace.

Fase 2:

- Dashboard externo para influenciador.
- Relatorio por influenciador.
- Comissoes/revenue share manual.

Fase 3:

- White label por influenciador.
- Customizacao de tema.
- Painel do influenciador.
- Revenue share automatico.
- Saque/comissao do influenciador.

---

## 21. Roadmap Tecnico Sugerido

### Prioridade 1 - Estabilidade dinheiro real

- Endurecer carteira com `REQUIRE_WALLET_LEDGER=true`.
- Testar idempotencia real no Supabase.
- Confirmar webhooks Amplopay em ambiente real.
- Criar rotina de conciliacao.
- Criar dashboard admin financeiro.
- Garantir que saldo provider cobre saques.

### Prioridade 2 - Anti-cheat Block Game

- Tornar pecas deterministicamente geradas por seed server-side.
- Guardar seed da rodada.
- Enviar movimentos do cliente para o backend.
- Validar placement, clears e game over server-side.
- Bloquear cashout se progresso real for menor que 3 clears.
- Liquidar payout apenas a partir do estado validado no servidor.

### Prioridade 3 - UX mobile final

- Testar iPhone/Android reais.
- Ajustar teclado no login.
- Ajustar viewport e safe areas.
- Melhorar loading/retry.
- Melhorar feedback de perda por crash vs colisao.

### Prioridade 4 - Arte final

- Spritesheet da sereia.
- Animacao nadando.
- Animacao de cashout/vitoria.
- Animacao de derrota.
- Obstaculos desenhados.
- Diamantes.
- Particulas.
- Audio.
- Logo.
- Banner promocional.

### Prioridade 5 - Agencia/influenciadores

- Referral code.
- UTM persistente.
- Tabela de afiliados.
- Dashboard de campanha.
- Relatorios.
- White label.

---

## 22. Prompt Base para Outro Chat

Use este bloco para abrir outra conversa sobre a agencia:

```text
Estou criando uma agencia/plataforma para vender/licenciar um jogo de cassino mobile-first para influenciadores.

O produto inicial se chama Sereia do Tesouro / Sereia Palace. A plataforma web mobile-first ja possui login, cadastro, lobby, carteira, Pix, historico, bonus, rollover e painel admin. No estado atual temporario, o gameplay ativo e um prototipo demo chamado internamente de Block Game: tabuleiro 8x8, tres pecas por ciclo, drag/drop, limpeza de linhas/colunas, dificuldade progressiva e resgate visual apos 3 clears. O deposito minimo da plataforma continua R$ 20 e a aposta minima do jogo segue configurada em R$ 30. Nesta fase, o Block Game nao debita saldo real nem credita payout real; a conexao financeira deve vir depois que a gameplay for aprovada.

Stack atual:
- Frontend/jogo: Phaser 3 + Vite.
- Backend: FastAPI.
- Banco: Supabase/Postgres.
- Pagamentos: Amplopay Pix.
- Realtime: WebSocket /ws/game ja existe para o motor anterior, mas o Block Game demo ainda nao usa.
- Deploy: Vercel frontend e Render backend.

O jogo ja tem:
- Login/cadastro.
- Lobby mobile estilo casa de apostas.
- Saldo real vindo do banco.
- Historico/stats reais.
- Deposito Pix via Amplopay.
- Saque Pix via Amplopay.
- Bonus de 100% para depositos a partir de R$ 100.
- Rollover 2x sobre o credito total.
- Conta admin/demo.
- RTP alvo aproximado de 95% no motor server-side anterior.
- Motor server-side com provably fair/HMAC preservado para futura adaptacao.
- Tracking first-touch por influenciador/campanha.
- Painel admin para criar influenciadores e campanhas.
- Metricas de campanha: cliques, cadastros, depositantes, FTD, depositos, GGR, CAC e resultado bruto da midia.

Quero criar a estrategia da agencia para vender isso para influenciadores, incluindo posicionamento, oferta, landing page, planos comerciais, comissao/revenue share, onboarding, apresentacao comercial, narrativa de marca e roadmap de funcionalidades como dashboard de afiliado, links de campanha, codigos promocionais e white label.

Importante:
- Nao prometer ganho garantido ao usuario final.
- Tratar como entretenimento 18+ com risco de perda.
- Separar o que ja existe do que ainda precisa ser desenvolvido.
```

---

## 23. Comandos Uteis

### Frontend

```bash
cd game
npm install
npm run dev
npm run build
```

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Testes

```bash
cd game
npm run test:block
cd ..
python backend/tests/test_wallet_rules.py
python backend/tests/test_casino.py
python -m compileall backend
```

### Supabase

Rodar no SQL Editor:

```text
backend/db/schema.sql
```

Depois, aguardar o reload do PostgREST/Supabase e redeploy do Render se necessario.

---

## 24. Notas de Operacao

- Deposito confirmado aumenta o saldo do usuario pelo valor bruto do Pix.
- Taxas da Amplopay nao reduzem o saldo visivel do usuario.
- A casa precisa manter saldo operacional suficiente na Amplopay para pagar saques.
- Se o usuario perde, a perda aparece como receita bruta de jogo no relatorio, mas deve sempre respeitar passivos de saldo dos jogadores.
- Bonus aumenta saldo do usuario e tambem aumenta rollover.
- Saque fica bloqueado enquanto rollover estiver pendente.
- Admin deve ser usado para teste/demo.
- Antes de vender para influenciadores em escala, e recomendavel validar o tracking por campanha com deposito real e relatorio manual.

---

## 25. Principais Arquivos para Continuar Desenvolvimento

Frontend:

- `game/src/main.js`: inicializacao Phaser, sessao e viewport.
- `game/src/config.js`: dimensoes, apostas, URLs e constantes.
- `game/src/scenes/AuthScene.js`: login/cadastro.
- `game/src/scenes/LobbyScene.js`: lobby, promocao, perfil, deposito e saque.
- `game/src/scenes/MenuScene.js`: escolha de aposta.
- `game/src/scenes/GameScene.js`: prototipo Block Game em modo demo.
- `game/src/block/BlockPuzzleLogic.js`: regras puras do puzzle, geracao de pecas, clears e game over.
- `game/tests/blockPuzzleLogic.test.mjs`: testes unitarios das regras do puzzle.
- `game/src/objects/*`: objetos do jogo classico/flap pausado; manter como referencia.
- `game/src/runner/ObstacleDirector.js`: runner pausado; manter como referencia enquanto a nova direcao e definida.
- `game/src/runner/RunnerActors.js`: runner pausado; atores vetoriais nao usados no gameplay ativo.
- `game/src/runner/RunnerHUD.js`: runner pausado; HUD nao usado no gameplay ativo.

Backend:

- `backend/main.py`: FastAPI, CORS, headers e health checks.
- `backend/routers/auth.py`: auth, cadastro, login e lobby snapshot.
- `backend/routers/game.py`: WebSocket autoritativo da rodada.
- `backend/routers/wallet.py`: deposito, saque, webhooks e admin finance.
- `backend/db/database.py`: Supabase, wallet, rollover, bonus e relatorios.
- `backend/db/schema.sql`: schema e RPC.
- `backend/services/auth.py`: hash e token.
- `backend/services/casino.py`: RTP/crash/payout.
- `backend/services/provably_fair.py`: seeds/HMAC.
- `backend/services/amplopay.py`: API Amplopay.

---

## 26. Estado de Prontidao

O jogo esta em fase avancada de MVP tecnico. Ele ja consegue rodar com login, Supabase, deposito Pix real gerado na Amplopay e wallet conectada. Para liberar para usuario final em escala, ainda faltam:

- QA real em celulares.
- Validacao completa de webhooks reais.
- Rotacao/conferencia de secrets.
- Monitoramento.
- Painel admin operacional.
- Anti-cheat adicional para colisao.
- Arte final.
- Dashboard externo para influenciadores.

Resumo: o projeto esta perto de piloto fechado, mas ainda nao deve ser tratado como operacao aberta de alto trafego sem esses checks.
