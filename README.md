# Block Rush

Puzzle de blocos com frontend em Phaser/Vite e plataforma de contas em FastAPI/Supabase. **Somente a conta definida em `ADMIN_USERNAME`, com papel ou permissão de administrador, usa modo demo.** Todas as demais contas jogam com o saldo da carteira: a aposta é debitada ao iniciar e o resgate confirmado é creditado pelo servidor.

Antes de publicar esta versão, aplique as [migrações de partidas](backend/db/migrations/README.md) no Supabase. Quem já executou `20260912_block_rounds.sql` precisa executar apenas `20260914_block_cashout_history.sql`, que adiciona o histórico demo e a regra de cinco limpezas sem redefinir saldos existentes. Configure `PAYMENT_PROVIDER=amplopay` e as credenciais do provedor para Pix de contas reais; falhas de configuração não habilitam saldo simulado.

Durante o teste fechado, depósitos continuam habilitados e saques de clientes ficam pausados por padrão com `WITHDRAWALS_ENABLED=false` no backend e `VITE_WITHDRAWALS_ENABLED` ausente ou diferente de `true` no frontend. O modal de saque permanece visível, mas o botão de solicitar saque fica desabilitado. O backend também bloqueia `POST /api/wallet/withdrawals` com 403 enquanto a flag não for alterada para `true`.

## Desenvolvimento

Frontend, com Node.js 20 ou superior:

```sh
cd game
npm ci
npm run dev
```

O Vite abre na porta 3000. Configure `VITE_API_URL` para apontar ao backend; sem essa variável, o frontend usa a porta 8000 do mesmo hostname.

Backend, em outro terminal, com as dependências de `backend/requirements.txt` instaladas em um ambiente virtual:

```sh
cd backend
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

As variáveis necessárias estão em `backend/.env.example`. Não publique credenciais no repositório. A revisão do schema e da carteira existente está em [docs/PROJECT_REVIEW.md](docs/PROJECT_REVIEW.md).

## Identidade e telas

- `game/src/brand.js`: nome, descrição e cores usadas pelo menu.
- `game/src/brand.css`: paleta compartilhada pelo lobby, acesso e administração.
- `game/index.html` e `game/public/favicon.svg`: título, metadados e ícone do navegador.
- `game/src/scenes`: login/cadastro, lobby, carteira, perfil, administração, seleção de aposta e puzzle.
- `backend/routers/block.py` e `backend/services/block_puzzle.py`: validação de jogadas, peças e resgates no servidor.

Linhas e colunas completas desaparecem imediatamente, com efeito visual simultâneo de 110 ms. Nas contas reais, a próxima jogada aguarda a confirmação do servidor. Atualizar a página retoma a rodada ativa sem cobrar outra aposta; repetições de uma mesma ação não duplicam pagamentos. Uma falha de comunicação pausa a partida e permite tentar novamente.

A dificuldade é igual para jogadores e para a demo admin. O primeiro lote começa no nível 2; após três jogadas passa ao nível 3 e após seis ao nível 4, que é o máximo. Limpezas também podem acelerar a progressão. Cada lote contém três formatos diferentes, com peso proporcional ao quadrado do tamanho da peça e ao seu nível, favorecendo peças grandes e complexas, incluindo quadrado 3×3, barra vertical de cinco e retângulo 4×2. O tamanho mínimo é de três blocos no nível 2 e quatro blocos nos níveis 3 e 4.

Quando existe um formato elegível que não cabe no tabuleiro, o novo lote inclui uma dessas peças; uma limpeza pode abrir espaço para ela. O sorteio não repete tentativas para garantir encaixe. Se nenhuma peça do lote couber, a rodada termina, inclusive na demo admin. Rodadas já abertas mantêm as peças recebidas e usam a nova regra a partir dos próximos lotes.

O botão de resgate aparece após completar cinco linhas ou colunas na mesma partida. Cada linha ou coluna conta uma limpeza, inclusive em combos; trocar o lote de peças não libera o resgate. Frontend, API e transação SQL exigem esse mesmo progresso.

O histórico sincroniza partidas reais e partidas demo do administrador. Resultados demo ficam em uma tabela separada, sem débito, crédito ou ledger financeiro. Se a conexão falhar, o navegador guarda cada resultado pendente por conta e tenta reenviar ao retornar ao lobby. O lobby atualiza saldo e histórico ao entrar, ao recuperar o foco e a cada 15 segundos enquanto está visível, sem interromper formulários da carteira.

Os arquivos e identificadores legados estão descritos na revisão. `write_files.py` é um gerador antigo e não deve ser usado para recriar as cenas atuais.

## Validação

```sh
cd game
npm test
npm run build
```

Os testes cobrem regras do puzzle, sessões, quebra imediata, resgate após cinco limpezas, sincronização e repetição de resultados demo e transações SQL em PostgreSQL local via PGlite, sem acessar saldos reais. O teste de paridade entre admin e jogadores também exige `python3` no PATH (ou a variável `PYTHON` com o executável), apenas com a biblioteca padrão.

Com as dependências Python instaladas, execute também:

```sh
python backend/tests/test_block_puzzle.py
python backend/tests/test_lobby_history.py
python backend/tests/test_wallet_rules.py
```

O primeiro verifica regras do servidor e endpoints com banco e pagamentos simulados, incluindo a exclusividade da conta demo.
