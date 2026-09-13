# Block Rush

Puzzle de blocos com frontend em Phaser/Vite e plataforma de contas em FastAPI/Supabase. **Somente a conta definida em `ADMIN_USERNAME`, com papel ou permissão de administrador, usa modo demo.** Todas as demais contas jogam com o saldo da carteira: a aposta é debitada ao iniciar e o resgate confirmado é creditado pelo servidor.

Antes de publicar esta versão, aplique a [migração de partidas](backend/db/migrations/README.md) no Supabase. Ela adiciona a persistência transacional sem redefinir saldos existentes. Configure `PAYMENT_PROVIDER=amplopay` e as credenciais do provedor para Pix de contas reais; falhas de configuração não habilitam saldo simulado.

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

Os arquivos e identificadores legados estão descritos na revisão. `write_files.py` é um gerador antigo e não deve ser usado para recriar as cenas atuais.

## Validação

```sh
cd game
npm test
npm run build
```

Os testes cobrem regras do puzzle, sessões, quebra imediata, confirmação de resgates e transações SQL em PostgreSQL local via PGlite, sem acessar saldos reais.

Com as dependências Python instaladas, execute também:

```sh
python backend/tests/test_block_puzzle.py
python backend/tests/test_wallet_rules.py
```

O primeiro verifica regras do servidor e endpoints com banco e pagamentos simulados, incluindo a exclusividade da conta demo.
