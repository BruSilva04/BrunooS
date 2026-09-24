# Migração do Block Rush para as contas de produção

Roteiro de infraestrutura conferido em 20/09/2026, com base no commit `4582049` e nas referências oficiais citadas abaixo. Atualizado em 24/09/2026 para incluir as migrações de criação conjunta de influenciadora e campanha e de saldo persistente de teste. Os exemplos são placeholders; substitua pelos valores das suas contas. Este documento não confirma o estado dos projetos nos painéis.

## 1. Escolha o caminho antes de alterar o banco

| Situação | Caminho |
| --- | --- |
| Quer mudar o responsável pelas contas e preservar usuários/saldos | Transferir o projeto Supabase e o projeto Vercel; recriar o backend no workspace Render de produção. |
| Tudo é teste e a produção deve começar vazia | Criar um Supabase novo, instalar os SQLs na ordem abaixo e publicar novos projetos Render/Vercel. |
| Precisa de um Supabase novo, mas também precisa preservar os dados | Fazer backup/restauração completa, com uma janela de manutenção e conferência dos dados. Não copiar apenas a tabela de usuários. |

Na ausência dessa decisão, preserve os dados. Criar uma conta nova no provedor não exige criar outro banco.

A transferência do Supabase exige Owner na organização de origem e participação na organização de destino; o painel verifica restrições, incluindo integrações e recursos existentes. Consulte a [transferência oficial do Supabase](https://supabase.com/docs/guides/platform/project-transfer).

A Vercel oferece transferência de projeto entre times. O Render atualmente não transfere serviços entre workspaces: é necessário recriá-los, ou manter o workspace atual e ajustar seus membros. Referências: [Vercel](https://vercel.com/docs/projects/transferring-projects), [Render](https://render.com/docs/faq#can-i-transfer-existing-services-from-one-workspace-to-another).

## 2. Prepare os acessos e registre os endereços

1. Garanta que a conta de produção controla a organização Supabase, o time Vercel e o workspace Render. Confirme os responsáveis e a cobrança.
2. Garanta acesso ao repositório `BruSilva04/BrunooS` no GitHub. A branch de produção é `main`; a correção da demo está no commit `4582049`.
3. Autorize as integrações GitHub da Vercel e do Render a acessar esse repositório na nova conta. Transferir o projeto de hospedagem não transfere a propriedade do repositório GitHub.
4. Registre os endereços atuais do frontend, backend e Supabase, os domínios e o `ADMIN_USERNAME`. Guarde as configurações atuais num local privado para poder reverter a aplicação.
5. Garanta um backup recuperável do banco antes da mudança. Faça isso mesmo ao transferir apenas a organização.
6. Mantenha os serviços anteriores até a validação e o tratamento dos pagamentos pendentes. Revise o auto-deploy deles para que futuros pushes não atualizem dois ambientes por acidente.

Preencha esta ficha sem colocar senhas nela:

| Item | Valor |
| --- | --- |
| Organização Supabase de produção | preencher |
| Projeto Supabase que será usado | preencher |
| URL Supabase | `https://SEU-PROJETO.supabase.co` |
| Workspace Render de produção | preencher |
| URL pública do backend | `https://SEU-BACKEND.onrender.com` ou domínio da API |
| Time Vercel de produção | preencher |
| URL pública do site | `https://SEU-PROJETO.vercel.app` ou domínio próprio |
| Username do administrador demo | preencher; preservar o atual se mantiver os dados |

Para produção com pagamentos, recomendo uma instância Render que não entre em suspensão: serviços gratuitos param após inatividade. Para uso comercial na Vercel, escolha um plano compatível; Hobby é restrito a uso pessoal não comercial. Veja [comportamento do Render](https://render.com/docs/faq#why-is-my-free-service-sometimes-slow-to-respond) e [Vercel Hobby](https://vercel.com/docs/plans/hobby). Confirme os valores de contratação nos painéis.

## 3A. Supabase: transferir o projeto atual

1. Na organização de produção, convide a conta que fará a transferência. Aceite o convite.
2. Com a conta Owner da origem, abra o projeto atual e vá a **Project Settings → General → Transfer Project**.
3. Selecione a organização de produção. Resolva eventuais impedimentos mostrados pelo painel e confira as condições de cobrança.
4. Confira o destino e conclua a transferência.
5. Na organização de produção, confirme o projeto, as tabelas e a URL de API. Isso muda a organização do projeto; não é uma restauração em banco vazio.
6. Não execute `schema.sql`. Se faltarem migrações de partidas ou campanhas, use somente os arquivos incrementais necessários, conforme o [README das migrações](../backend/db/migrations/README.md).

Não suponha que transferir a organização revoga credenciais já conhecidas por outras pessoas. Quando for necessário trocar a chave do backend, configure e valide a nova em todos os backends ainda ativos, inclusive o Render antigo que recebe callbacks. Só então retire a chave antiga.

## 3B. Supabase: criar produção vazia

Use este caminho somente se confirmou que os registros atuais são descartáveis ou pertencem exclusivamente ao ambiente de testes.

1. Entre na organização de produção e crie um **New project**.
2. Escolha o nome, a região e uma senha de banco forte. Guarde a senha em um gerenciador. A senha do PostgreSQL não é a chave de API usada pelo backend.
3. Aguarde o banco ficar disponível.
4. Antes de publicar o backend, abra **SQL Editor → New query** e execute cada arquivo inteiro, separadamente, nesta ordem:

| Ordem | Arquivo |
| --- | --- |
| 1 | [backend/db/schema.sql](../backend/db/schema.sql) |
| 2 | [20260912_block_rounds.sql](../backend/db/migrations/20260912_block_rounds.sql) |
| 3 | [20260914_block_cashout_history.sql](../backend/db/migrations/20260914_block_cashout_history.sql) |
| 4 | [20260923_affiliate_campaign.sql](../backend/db/migrations/20260923_affiliate_campaign.sql) |
| 5 | [20260924_demo_balance.sql](../backend/db/migrations/20260924_demo_balance.sql) |

**`schema.sql` contém uma reconciliação que recalcula o saldo de não administradores a partir do ledger. Não o execute em banco com dados que precisam ser preservados, nem depois de restaurar um backup.** O segundo arquivo também restaura uma versão anterior da função de resgate: se precisar reaplicá-lo, aplique o terceiro depois.

5. Confira a existência das tabelas e funções usando as consultas da seção 4.
6. Obtenha a URL do projeto pelo diálogo **Connect**/configurações de API. Em **Settings → API Keys**, obtenha uma chave **secret** para o backend. O código recebe essa chave em `SUPABASE_SECRET_KEY`.

Use chave de servidor `sb_secret_...` ou, se estiver preservando uma integração legada existente, `service_role`; não use a chave pública `anon`/publishable para esse backend. A chave secreta vai somente no Render. [Chaves oficiais do Supabase](https://supabase.com/docs/guides/getting-started/api-keys).

## 3C. Supabase: projeto novo preservando dados

Prefira 3A se a necessidade for apenas mudar a conta responsável. Se outro projeto for obrigatório, siga a [migração oficial por backup/restauração](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

1. Prepare o destino e ensaie a restauração antes da troca definitiva.
2. Copie schema, funções, permissões, índices, dados e relacionamentos. Preserve também os metadados dos pagamentos e tokens de webhook armazenados no banco.
3. No ensaio, confira usuários e hashes de senha, saldos por conta, ledger, partidas reais/demo, depósitos, saques, settlements, campanhas e atribuição.
4. Na troca definitiva, interrompa novas escritas no backend de origem, faça o backup final e restaure no destino. O projeto não possui uma flag global de manutenção: `WITHDRAWALS_ENABLED=false` bloqueia apenas novos saques de clientes. Fechar o site ou alterar CORS também não bloqueia chamadas diretas à API.
5. A janela precisa incluir uma estratégia para webhooks que chegarem durante a cópia: encaminhamento ao backend que usa o banco definitivo ou reprocessamento confirmado pelo provedor. Não deixe pagamentos posteriores ao backup presos somente na origem.
6. Não rode o `schema.sql` do repositório no banco restaurado. Aplique somente migrações incrementais realmente ausentes.
7. Compare dados da origem congelada com o destino e atualize o Render para a URL e chave do destino.
8. Depois da liberação, o destino deve ser a única fonte de verdade. Não mantenha duas cópias recebendo operações financeiras independentes.

O roteiro exato de exportação depende do tipo de backup disponível e da conexão PostgreSQL da conta. A documentação oficial cobre CLI/dump e restauração; não substitua esse processo por exportar/importar CSVs. Backups do banco não incluem os arquivos dos buckets Storage. O código deste repositório não usa Storage nem Edge Functions, mas confira recursos criados manualmente no painel.

O login deste projeto é próprio: usuários e `password_hash` estão em `public.users`. A tela **Authentication → Users** do Supabase não representa os cadastros do jogo.

## 4. Confira o banco sem alterar dados

Execute no SQL Editor, no projeto de destino:

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'rounds', 'wallet_transactions', 'payment_intents',
    'withdrawal_requests', 'operator_settlements', 'affiliates',
    'campaigns', 'acquisition_clicks', 'block_demo_rounds', 'block_demo_stakes'
  )
ORDER BY tablename;

SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'adjust_wallet_balance', 'start_block_round', 'commit_block_round',
    'read_block_round', 'read_lobby_snapshot', 'create_affiliate_with_campaign',
    'start_block_demo_round', 'settle_block_demo_round', 'confirm_block_demo_deposit'
  )
ORDER BY proname;
```

Espera-se encontrar as onze tabelas e as nove funções. Existência não garante a versão correta: confirme também que as migrações de 14/09, 23/09 e 24/09 foram aplicadas nessa ordem e valide as regras no aplicativo.

Confira também as permissões das funções. Para cada uma, `backend_pode` deve ser `true`, e `anon_pode` e `authenticated_pode` devem ser `false`:

```sql
SELECT
  p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS backend_pode,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_pode
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'adjust_wallet_balance', 'start_block_round', 'commit_block_round',
    'read_block_round', 'read_lobby_snapshot', 'create_affiliate_with_campaign',
    'start_block_demo_round', 'settle_block_demo_round', 'confirm_block_demo_deposit'
  )
ORDER BY p.proname;

SELECT c.relname AS tabela, c.relrowsecurity AS rls_ativo
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
```

As onze tabelas do aplicativo devem ter `rls_ativo=true`. Se uma verificação falhar, confira a execução integral das migrações antes de liberar o ambiente; não tente resolver habilitando acesso público às funções financeiras.

Se os dados foram copiados, compare contagens e valores por conta antes de permitir novas escritas. Uma soma total igual não prova que cada saldo está correto. Nunca inclua senhas, hashes, documentos ou tokens em prints compartilhados.

## 5. Render: recrie o backend na conta de produção

1. Entre no workspace correto e escolha **New → Web Service**.
2. Conecte o GitHub e selecione `BruSilva04/BrunooS`.
3. Configure:

| Campo | Valor |
| --- | --- |
| Nome | um nome de produção, por exemplo `block-rush-api-prod` |
| Branch | `main` |
| Runtime/Language | Python 3 |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path | `/health` |
| Região | escolha uma com baixa latência para o Supabase |

O [`render.yaml`](../render.yaml) atual já aponta para `backend` e usa porta 10000. O comando acima utiliza a porta fornecida pelo Render. Não crie outro PostgreSQL no Render: o projeto usa Supabase. Referência: [deploy FastAPI no Render](https://render.com/docs/deploy-fastapi).

O repositório fixa Python `3.11.9` nos arquivos `.python-version`. Confira a versão no log; se precisar reproduzi-la explicitamente, use `PYTHON_VERSION=3.11.9`. A variável tem precedência sobre o arquivo. [Configuração de Python no Render](https://render.com/docs/python-version).

4. Antes do primeiro start, cadastre as variáveis abaixo na seção **Environment**. Use os campos de nome e valor separadamente; não coloque `NOME=` dentro do campo de valor.

| Variável | Valor/decisão |
| --- | --- |
| `SUPABASE_URL` | URL do projeto de produção |
| `SUPABASE_SECRET_KEY` | chave secret do projeto, ou a chave service_role legada mantida durante a transferência |
| `AUTH_SECRET` | segredo longo e aleatório; preservar o atual se quiser manter sessões existentes |
| `AUTH_TOKEN_TTL_SECONDS` | `14400` |
| `ADMIN_USERNAME` | username da única conta demo; preservar exatamente o atual se conservar os dados |
| `ADMIN_PASSWORD` | senha forte para esse administrador |
| `ADMIN_EMAIL` | e-mail do administrador |
| `ADMIN_PHONE` | telefone do administrador com código do país |
| `ALLOWED_ORIGINS` | origens HTTPS exatas do site, separadas por vírgula, sem barra final |
| `ALLOW_VERCEL_PREVIEWS` | `false` para o backend de produção |
| `BACKEND_PUBLIC_URL` | URL pública HTTPS deste novo backend, sem barra final |
| `PAYMENT_PROVIDER` | `amplopay` para habilitar pagamentos reais das contas comuns |
| `AMPLOPAY_BASE_URL` | `https://app.amplopay.com/api/v1` |
| `AMPLOPAY_PUBLIC_KEY` | credencial da conta Amplopay correta para produção |
| `AMPLOPAY_SECRET_KEY` | segredo da mesma conta Amplopay |
| `AMPLOPAY_REQUIRE_WEBHOOK_TOKEN` | `true` |
| `REQUIRE_WALLET_LEDGER` | `true` |
| `WITHDRAWALS_ENABLED` | `false` durante a preparação, preservando o bloqueio atual |

Exemplo de `ALLOWED_ORIGINS`:

```text
https://SEU-PROJETO.vercel.app,https://jogo.seudominio.com
```

Use somente endereços reais que já anotou. Quando a URL do novo frontend for conhecida, acrescente-a e faça redeploy do backend. CORS é uma regra do navegador, não uma barreira para todas as chamadas à API.

`BACKEND_PUBLIC_URL` precisa refletir o novo serviço. Se a URL ainda não foi atribuída, deixe essa variável ausente no primeiro deploy: o código usa `RENDER_EXTERNAL_URL` automaticamente. Depois registre o endereço correto, em vez de deixar o endereço do backend antigo ou um placeholder.

Para um ambiente completamente novo, você pode gerar o `AUTH_SECRET` no seu computador com:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Cole a saída apenas no painel privado do Render. Trocar `AUTH_SECRET` invalida os tokens atuais e exige novo login; não altera as senhas dos usuários. Preservar usuários depende de preservar `public.users`, não desse segredo. Se `AUTH_SECRET` não estava definido, o código usava a chave Supabase como segredo de assinatura: configurar um segredo novo também exigirá login novamente.

**Administrador:** o startup cria/atualiza a conta de `ADMIN_USERNAME`; se `ADMIN_PASSWORD` estiver definido, sua senha é atualizada a cada início. Não use o username de um jogador. Em banco preservado, mudar `ADMIN_USERNAME` pode fazer o administrador antigo deixar de ser demo e usar seu saldo persistido. O bootstrap legado ainda cria saldo persistido de 100000; o modo de teste usa `users.demo_balance`, separado da carteira real, com crédito inicial de R$ 100 e atualização por aposta e resgate. Não altere a carteira real para reproduzir o saldo de teste.

Enquanto dois backends compartilharem o banco, mantenha as configurações administrativas compatíveis: um reinício do serviço antigo com outro `ADMIN_PASSWORD`, `ADMIN_EMAIL` ou `ADMIN_PHONE` pode sobrescrever as novas informações. Se a conta já existe e não precisa trocar a senha, `ADMIN_PASSWORD` pode ficar ausente; num banco novo ele é necessário para criar o administrador.

5. Salve com deploy e confira os logs. Verifique o commit `4582049` ou outro posterior que contenha a correção.
6. Abra os dois endereços:

```text
https://SEU-BACKEND.onrender.com/health
https://SEU-BACKEND.onrender.com/health/db
```

O primeiro deve retornar `status: ok`. O segundo deve retornar também `database: supabase`. `/health` sozinho não comprova acesso ao banco, porque o startup registra falhas de inicialização e mantém o processo disponível. `/health/db` verifica conectividade e uma função da carteira, mas não substitui a conferência das migrações e o teste do jogo.

Se `/health/db` sugerir executar `schema.sql`, não siga essa mensagem automaticamente num banco com dados. Investigue a chave, as permissões e a função faltante.

Salvar variáveis sem deploy não atualiza o processo em execução. [Variáveis no Render](https://render.com/docs/configure-environment-variables).

## 6. Vercel: transfira ou crie o frontend

Para transferir o projeto existente: **Project → Settings → General → Transfer Project**, escolha o time de produção e revise a transferência. É necessário ser Owner na origem e membro do destino. Verifique as variáveis, domínio e conexão Git após a transferência; integrações precisam ser configuradas novamente quando aplicável. [Transferência Vercel](https://vercel.com/docs/projects/transferring-projects).

Para criar outro projeto: na conta de produção use **Add New → Project → Import Git Repository**, escolha o mesmo repositório e configure:

| Campo | Valor |
| --- | --- |
| Framework Preset | Vite |
| Root Directory | `game` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Production Branch | `main` |
| Node.js | 22.x, usado na validação local |

Como a raiz já é `game`, a saída é `dist`, não `game/dist`. [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite).

Na seção **Environment Variables**, para o ambiente **Production**, configure:

| Variável | Valor |
| --- | --- |
| `VITE_API_URL` | URL HTTPS do novo backend, sem `/api` no final |
| `VITE_WITHDRAWALS_ENABLED` | `false` durante a preparação |
| `VITE_WS_URL` | opcional para o jogo legado: `wss://SEU-BACKEND.onrender.com/ws/game` |

O Block Rush atual usa HTTP e não depende de `VITE_WS_URL`. O código acrescenta `/api/...` nas requisições, portanto `VITE_API_URL` deve conter somente a origem da API.

Não cadastre chave secreta Supabase, `AUTH_SECRET`, senha admin ou credenciais Amplopay em variáveis `VITE_*`. Elas são incorporadas ao JavaScript entregue ao navegador. Neste projeto, o frontend não se conecta diretamente ao Supabase.

Faça o deploy e, ao obter a URL do site, acrescente-a a `ALLOWED_ORIGINS` no Render. Se alterar qualquer `VITE_*`, faça novo deploy na Vercel: mudar a variável não atualiza builds anteriores. [Variáveis Vercel](https://vercel.com/docs/environment-variables).

Use um backend/banco de testes para Preview. Não vincule todos os previews automaticamente ao banco de produção.

## 7. Domínios e callbacks de pagamento

Se usar domínio próprio, adicione-o no painel do frontend/backend correspondente e siga os registros DNS exibidos pelo provedor. Verifique HTTPS antes de usá-lo nas variáveis. Quando o domínio mudar, atualize os três pontos que se referem a ele:

- Frontend → `VITE_API_URL` do novo backend.
- Backend → `ALLOWED_ORIGINS` do site.
- Backend → `BACKEND_PUBLIC_URL` para os callbacks Pix.

Neste código, o backend envia `callbackUrl` ao criar cada cobrança/transferência. As rotas são:

```text
POST https://SEU-BACKEND/api/wallet/webhooks/amplopay/payment
POST https://SEU-BACKEND/api/wallet/webhooks/amplopay/transfer
```

Trocar apenas um endereço no painel do provedor não substitui automaticamente URLs já associadas a cobranças antigas. Confira também qualquer configuração independente existente na conta Amplopay.

Se houver pagamentos pendentes, mantenha a URL antiga atendendo ou providencie encaminhamento/reprocessamento compatível com o provedor. Os callbacks antigos e novos devem consultar a mesma base financeira definitiva. Não exclua o Render antigo só porque o frontend novo abriu.

Se também estiver mudando a conta Amplopay, trate as cobranças pendentes da conta anterior separadamente: credenciais novas não migram cobranças antigas.

## 8. Validação antes de mudar o endereço público

1. Confirme o commit publicado no frontend e no backend.
2. Confira `/health`, `/health/db` e as funções/tabelas do banco.
3. Faça login no administrador configurado: deve mostrar “Modo de teste”, começar com R$ 100 no primeiro uso e manter peças simples no nível fácil mesmo após várias jogadas.
4. Jogue uma partida de teste: a aposta deve descontar do saldo e o resgate deve creditar o prêmio. Volte ao lobby e recarregue: o saldo atualizado deve persistir e o resultado deve sincronizar no histórico.
5. Crie uma conta comum de teste identificável: começa com saldo zero, sem indicação de demo, e não recebe os R$ 100 do administrador.
6. Se estiver preservando usuários, confira login e dados de contas existentes, além dos saldos por usuário.
7. Verifique no navegador que as requisições vão ao Render correto e que não há erro de CORS.
8. Faça um teste controlado de Pix somente quando a conta de pagamentos e o banco definitivos estiverem confirmados. Confira crédito uma única vez e registro no ledger. No código atual, o depósito mínimo é R$ 20 e a aposta mínima é R$ 30; para testar também o jogo real, o saldo precisa cobrir a aposta.
9. Confira débito ao iniciar a rodada real, retomada após recarregar e histórico. O resgate só libera após cinco linhas/colunas.
10. Durante a migração, mantenha as duas flags de saque em `false`. Isso não desativa depósitos nem apostas. Para reabrir saques depois da validação, configure `WITHDRAWALS_ENABLED=true` no Render e `VITE_WITHDRAWALS_ENABLED=true` na Vercel e publique os dois.

## 9. Faça a troca definitiva e mantenha um caminho de retorno

1. Com os testes concluídos, aponte o domínio/link público para o frontend definitivo.
2. Confira novamente URLs, CORS, login, saldo e callbacks usando esse endereço.
3. Acompanhe logs do Render, falhas de API e eventos Pix até confirmar o processamento dos pendentes.
4. Retire acessos antigos e credenciais que não devem continuar válidos, validando seus substitutos em todos os serviços ainda ativos antes da revogação, inclusive os que atendem callbacks antigos.
5. Só desative os projetos antigos quando não forem mais necessários para callbacks, dados ou retorno operacional.

Se o banco foi apenas transferido e continua o mesmo, a aplicação pode voltar à versão anterior compatível sem restaurar saldos antigos. Se o banco foi copiado e o novo já recebeu operações, não volte para o backup antigo: ele não terá essas operações. Nesse caso, preserve o banco definitivo e reverta somente código/configuração compatível, ou faça uma reconciliação planejada.

## 10. Erros que ajudam a localizar a configuração incorreta

| Sintoma | Conferir |
| --- | --- |
| Frontend tenta acessar a porta 8000 | `VITE_API_URL` ausente no build de produção; configure e publique novamente. |
| Erro de CORS | Origem exata do site em `ALLOWED_ORIGINS`; sem caminhos/barra final; redeploy do Render. |
| `/health` funciona, mas login falha | `/health/db`, chave Supabase, schema e logs de inicialização. |
| Admin não aparece ou senha não funciona | `ADMIN_USERNAME`, `ADMIN_PASSWORD`, criação/atualização no startup e banco conectado. |
| Demo mostra outro valor ou fica difícil | Backend/frontend executando o commit correto e ambos apontando para o ambiente esperado. |
| Partida real indisponível | Migrações de 12/09 e 14/09, permissões das RPCs e credencial de servidor. |
| Criar influenciadora retorna 503 | Aplicar `20260923_affiliate_campaign.sql` antes de publicar o backend. |
| Histórico demo fica pendente | Tabela `block_demo_rounds` e migração de 14/09. |
| Pix continua chamando o backend antigo | `BACKEND_PUBLIC_URL` e callbacks já registrados nas cobranças anteriores. |
| Botão de saque desabilitado | As duas flags de saque e, quando habilitado, a regra de rollover. |
