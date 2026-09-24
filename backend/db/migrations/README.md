# Partidas e histórico Block Rush

Se você já executou `20260912_block_rounds.sql`, execute somente o arquivo novo [20260914_block_cashout_history.sql](20260914_block_cashout_history.sql):

1. Abra o arquivo e copie todo o conteúdo.
2. No projeto correto do Supabase, abra **SQL Editor → New query**.
3. Cole o conteúdo e clique em **Run**. Aguarde a confirmação de sucesso.

O arquivo cria o histórico demo separado das movimentações financeiras, adiciona a leitura conjunta de saldo e histórico e exige cinco linhas ou colunas completas para resgatar. Ele pode ser reaplicado e não recalcula saldos existentes. Aplique-o para ativar a sincronização demo e a validação SQL atualizada.

Para um banco que ainda não recebeu as partidas Block Rush, execute primeiro [20260912_block_rounds.sql](20260912_block_rounds.sql) e depois o arquivo novo. A primeira migração depende das tabelas e da função `adjust_wallet_balance` já presentes no projeto.

Não execute o arquivo completo `backend/db/schema.sql` para esta atualização: ele contém uma reconciliação antiga que pode recalcular saldos existentes.

Para conferir a instalação, esta consulta deve retornar quatro funções:

```sql
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('start_block_round', 'commit_block_round', 'read_block_round', 'read_lobby_snapshot');
```

No ambiente do backend, confira `ADMIN_USERNAME` (a única conta demo, que também precisa ter acesso de administrador), `PAYMENT_PROVIDER=amplopay`, as credenciais Amplopay e `BACKEND_PUBLIC_URL`. Use `REQUIRE_WALLET_LEDGER=true` para os fluxos de carteira existentes. As partidas Block Rush exigem as funções transacionais independentemente dessa variável.

Enquanto apenas a migração de 12/09 estiver instalada, o lobby mantém a leitura anterior dos registros reais e os resultados demo ficam pendentes no navegador. A API já exige cinco limpezas para resgatar. O caminho de compatibilidade é usado somente quando a nova função está ausente; outros erros continuam sendo reportados. Sem a primeira migração, partidas reais ficam indisponíveis. A execução do SQL no Supabase é uma etapa separada dos testes locais e do push.


## Influenciadora com campanha e link automático

Antes de publicar a versão que gera o link ao criar uma influenciadora, execute [20260923_affiliate_campaign.sql](20260923_affiliate_campaign.sql) no **SQL Editor → New query → Run**, no projeto correto do Supabase. Ela cria as tabelas de aquisição (`affiliates`, `campaigns` e `acquisition_clicks`) e as colunas de atribuição se estiverem ausentes. Depende das tabelas de aplicação `users` e `payment_intents` e pode ser reaplicada. Não atualiza registros financeiros nem redefine saldos.

A função `create_affiliate_with_campaign` salva a influenciadora e a campanha na mesma transação: se a campanha falhar, a influenciadora também não é inserida. Somente o backend com `service_role` pode executá-la; o endpoint verifica a permissão de administrador. Não há comissão nem alteração de saldo. O código do link é gerado automaticamente e protegido por índice único.

Confira a instalação com uma consulta somente de leitura:

```sql
SELECT p.proname,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS backend_pode,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_pode,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_pode
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'create_affiliate_with_campaign';
```

O resultado deve ser uma linha, com `backend_pode=true` e os outros dois campos `false`. Sem esta migração, a criação conjunta responde 503; não existe tentativa alternativa que deixe uma influenciadora sem campanha. Aplique o SQL antes de publicar o backend e o frontend. Para um banco novo e vazio, siga a ordem completa no [guia de produção](../../../docs/MIGRACAO_PRODUCAO.md).
