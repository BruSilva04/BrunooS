# Partidas Block Rush

Para atualizar um banco já existente, abra o **SQL Editor** do projeto Supabase, crie uma consulta, cole todo o conteúdo de [20260912_block_rounds.sql](20260912_block_rounds.sql) e execute com **Run** antes de publicar o backend e o frontend desta versão.

O arquivo usa uma transação, adiciona colunas e funções às tabelas existentes e pode ser reaplicado. Não redefine saldos nem cria crédito para jogadores. Depende das tabelas e da função `adjust_wallet_balance` já presentes no schema do projeto.

Não execute o arquivo completo `backend/db/schema.sql` para esta atualização: ele contém uma reconciliação antiga que pode recalcular saldos existentes.

Depois da execução, esta consulta deve retornar as três funções:

```sql
SELECT proname
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('start_block_round', 'commit_block_round', 'read_block_round');
```

No ambiente do backend, confira `ADMIN_USERNAME` (a única conta demo, que também precisa ter acesso de administrador), `PAYMENT_PROVIDER=amplopay`, as credenciais Amplopay e `BACKEND_PUBLIC_URL`. Use `REQUIRE_WALLET_LEDGER=true` para os fluxos de carteira existentes. As partidas Block Rush exigem as funções transacionais independentemente dessa variável.

Sem a migração, partidas reais retornam indisponibilidade; o jogo não cria uma rodada fictícia nem tenta debitar a carteira por um caminho alternativo. A aplicação deste arquivo em produção é uma etapa separada dos testes locais e do push.
