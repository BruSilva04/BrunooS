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
