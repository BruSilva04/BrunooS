# Block Rush

Puzzle de blocos com frontend em Phaser/Vite e plataforma de contas em FastAPI/Supabase. O jogo atual funciona em **modo demo**: pode ser aberto com saldo zero e não debita, credita ou movimenta o rollover da carteira.

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
- `game/src/scenes`: login/cadastro, lobby, carteira, perfil, administração, preparação da demo e puzzle.

Os arquivos e identificadores legados estão descritos na revisão. `write_files.py` é um gerador antigo e não deve ser usado para recriar as cenas atuais.

## Validação

```sh
cd game
npm test
npm run build
```

Os testes cobrem as regras do puzzle, tratamento de erros da API e compatibilidade das sessões existentes. Testes do backend ficam em `backend/tests`.
