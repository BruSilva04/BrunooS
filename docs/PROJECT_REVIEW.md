Revisão do projeto — Block Rush — 12/09/2026

O frontend ativo usa Vite e Phaser, com login/cadastro, lobby, carteira, administração, seleção de aposta e puzzle de blocos. A identidade está centralizada em [brand.js](../game/src/brand.js) e [brand.css](../game/src/brand.css).

A conta configurada em `ADMIN_USERNAME`, desde que tenha papel ou permissão de administrador, é a única conta demo. Outras contas, inclusive outros administradores, usam saldo real. A autorização é calculada pelo backend e não aceita uma escolha de modo enviada pelo navegador. O cadastro de jogadores continua começando com saldo zero.

O puzzle usa tabuleiro 8×8, três peças por lote e libera resgate após três linhas ou colunas completas. A limpeza do tabuleiro é imediata, acompanhada por um único efeito de 110 ms, sem atraso por célula. Em contas reais, cada jogada é confirmada pelo servidor antes da próxima entrada.

[block.py](../backend/routers/block.py) valida autenticação, peças, posições, versão da rodada e resgates. [block_puzzle.py](../backend/services/block_puzzle.py) calcula o progresso e o pagamento em centavos, preservando a progressão do puzzle existente. As peças são sorteadas no servidor; este trabalho não implementa verificação pública desse sorteio nem valida o retorno econômico do puzzle. O motor de crash em [game.py](../backend/routers/game.py) é uma implementação anterior, com regras diferentes.

A [migração de partidas](../backend/db/migrations/20260912_block_rounds.sql) reúne aposta, histórico, ledger e rollover na mesma transação. O resgate também é liquidado junto da conclusão da rodada. Há uma rodada ativa por conta; atualizar a página ou abrir outra aba retoma essa rodada. Identificadores de ação e versões evitam duplicidade e alterações concorrentes incompatíveis. Falhas de persistência pausam a partida, sem recorrer ao modo demo ou a gravações financeiras separadas.

Depósitos e saques sandbox são exclusivos da conta demo. Jogadores comuns exigem Amplopay configurado e não podem confirmar depósitos de teste. A conta demo não solicita transferências reais ao provedor. A URL de callback de saque é validada antes da reserva do valor.

Validação local desta alteração:

- Testes de regras do puzzle e da API JavaScript, preservando as sessões existentes.
- Testes da cena com respostas de rede controladas: quebra antes da resposta HTTP, resgate somente após confirmação, repetição da mesma ação e descarte de respostas de uma cena encerrada.
- Migração executada duas vezes sobre PostgreSQL local via PGlite, com saldos existentes preservados. Testes de aposta, resgate, perda, concorrência por versão, repetição, propriedade da rodada, rollover, permissões e reversão integral diante de falhas de gravação.
- 18 testes Python das regras e endpoints com banco e pagamentos simulados.
- Testes existentes de carteira, aquisição e motor de crash. A simulação de crash não mede o retorno do puzzle.
- Build de produção. Permanece o aviso de bundle acima de 500 kB, principalmente pelo Phaser.
- Chrome com APIs simuladas: 24 verificações de login, lobby, carteira e demo em telas de celular e desktop; outras 11 verificações do fluxo de jogador real, incluindo quebra antes da resposta, falha de resgate, repetição e saldo confirmado. Os cliques do segundo roteiro foram enviados como eventos DOM ao canvas devido a uma falha no encaminhamento de cliques pelo Chrome remoto. Nenhum dos roteiros registrou exceções JavaScript.

A aplicação da migração em produção e a integração com pagamentos reais são etapas externas aos testes locais. Siga [as instruções de atualização](../backend/db/migrations/README.md). Não houve criação de depósitos, saques ou apostas em contas reais para testar estas alterações.

Pontos preexistentes que continuam exigindo atenção na operação da carteira:

1. O arquivo completo [schema.sql](../backend/db/schema.sql) contém uma reconciliação que recalcula saldos não administrativos. Para esta atualização, execute somente a migração incremental. Ela também revoga a execução pública da RPC de saldo, mantendo o acesso pelo backend com `service_role`.
2. Fluxos antigos de carteira permitem gravações separadas quando `REQUIRE_WALLET_LEDGER=false`. Configure `true` em produção. O novo puzzle exige transações independentemente dessa variável.
3. Reserva de saque, criação da solicitação e comunicação com o provedor ainda não formam uma única operação transacional. A configuração do callback é validada antes da reserva, mas falhas de inserção ou transporte ainda exigem reconciliação operacional; um timeout não confirma o resultado de uma transferência.

[sereia-GDD.md](../sereia-GDD.md), [sereia-do-tesouro.html](../sereia-do-tesouro.html), [write_files.py](../write_files.py), [game/src/runner](../game/src/runner) e os objetos da sereia são referências ou implementações legadas, fora da entrada ativa do Vite. Não use o gerador antigo para recriar as cenas atuais. As chaves `sereia_*` de sessão, atribuição, tutorial e som foram preservadas para manter os dados locais existentes.
