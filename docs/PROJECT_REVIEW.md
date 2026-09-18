Revisão do projeto — Block Rush — atualizada em 18/09/2026

O frontend ativo usa Vite e Phaser, com login/cadastro, lobby, carteira, administração, seleção de aposta e puzzle de blocos. A identidade está centralizada em [brand.js](../game/src/brand.js) e [brand.css](../game/src/brand.css).

A conta configurada em `ADMIN_USERNAME`, desde que tenha papel ou permissão de administrador, é a única conta demo. Ela exibe saldo demonstrativo fixo de R$ 100 no acesso, lobby, carteira e jogo, sem alterar o saldo persistido. Outras contas, inclusive outros administradores, usam saldo real. A autorização é calculada pelo backend e não aceita uma escolha de modo enviada pelo navegador. O cadastro de jogadores continua começando com saldo zero.

O puzzle usa tabuleiro 8×8 e três peças por lote. O botão de resgate aparece após cinco linhas ou colunas completas na mesma partida, contando cada linha ou coluna de um combo. A troca de lote não conta como limpeza. Frontend, API e SQL aplicam o limite. A limpeza do tabuleiro é imediata, acompanhada por um único efeito de 110 ms, sem atraso por célula. Em contas reais, cada jogada é confirmada pelo servidor antes da próxima entrada.

[block.py](../backend/routers/block.py) valida autenticação, peças, posições, versão da rodada e resgates. [block_puzzle.py](../backend/services/block_puzzle.py) calcula o progresso e o pagamento em centavos. A dificuldade do sorteio real foi ampliada em 14/09/2026: níveis 2, 3 e 4 a partir de 0, 3 e 6 jogadas; três formatos distintos por lote; preferência por peças grandes; inclusão de uma peça inicialmente sem encaixe quando possível; sem sorteio de peças de um ou dois blocos ou tentativas de garantir uma jogada. As regras reais em JavaScript são verificadas por testes de paridade com o servidor. A fórmula de pagamento permanece a mesma. As peças das partidas reais são sorteadas no servidor; este trabalho não implementa verificação pública desse sorteio nem valida o retorno econômico do puzzle. O motor de crash em [game.py](../backend/routers/game.py) é uma implementação anterior, com regras diferentes.

A [migração de partidas](../backend/db/migrations/20260912_block_rounds.sql) reúne aposta, histórico, ledger e rollover na mesma transação. O resgate também é liquidado junto da conclusão da rodada. Há uma rodada ativa por conta; atualizar a página ou abrir outra aba retoma essa rodada. Identificadores de ação e versões evitam duplicidade e alterações concorrentes incompatíveis. Falhas de persistência pausam a partida, sem recorrer ao modo demo ou a gravações financeiras separadas.

Depósitos e saques sandbox são exclusivos da conta demo. Jogadores comuns exigem Amplopay configurado e não podem confirmar depósitos de teste. A conta demo não solicita transferências reais ao provedor. A URL de callback de saque é validada antes da reserva do valor.

A dificuldade real usa peso quadrático do tamanho da peça e, a partir do nível 3, somente peças com quatro ou mais blocos são sorteadas. Desde 18/09/2026, a demo admin usa nível 1 fixo e sorteia peças simples que cabem no tabuleiro naquele momento, incluindo peças de um e dois blocos, sem favorecer as maiores. Formatos podem se repetir. Se nenhuma peça restante couber após uma jogada, a rodada demo também termina.

A [migração de histórico e resgate](../backend/db/migrations/20260914_block_cashout_history.sql) adiciona `block_demo_rounds`, isolada das transações financeiras, e uma leitura conjunta de saldo e histórico. O endpoint demo só aceita a conta administrativa configurada, calcula o valor no servidor e insere cada resultado uma única vez. Falhas de rede deixam uma pendência persistida por conta no navegador; voltar ao lobby tenta sincronizá-la novamente. O lobby consulta os registros ao entrar, ao recuperar foco e a cada 15 segundos enquanto está visível e sem formulário aberto. Respostas antigas não substituem dados de uma consulta mais recente.

Durante a atualização, se a nova RPC ainda estiver ausente, o lobby usa a leitura anterior dos registros reais. A sincronização demo fica indicada como pendente até aplicar a migração. Falhas genéricas de banco não acionam esse caminho de compatibilidade.

Histórico de validações locais anteriores:

- Testes de regras do puzzle e da API JavaScript, preservando as sessões existentes.
- Testes da cena com respostas de rede controladas: quebra antes da resposta HTTP, resgate somente após confirmação, repetição da mesma ação e descarte de respostas de uma cena encerrada.
- Migração executada duas vezes sobre PostgreSQL local via PGlite, com saldos existentes preservados. Testes de aposta, resgate, perda, concorrência por versão, repetição, propriedade da rodada, rollover, permissões e reversão integral diante de falhas de gravação.
- 25 testes Python das regras e endpoints, incluindo o limite de cinco limpezas e a gravação demo sem movimentar carteira; mais cinco testes da leitura conjunta de histórico e saldo e da compatibilidade antes da migração.
- Testes de histórico demo idempotente, isolamento entre contas, repetição após falha e atualização periódica do lobby. A nova migração também foi aplicada duas vezes no PostgreSQL local, preservando saldos.
- Testes existentes de carteira, aquisição e motor de crash. A simulação de crash não mede o retorno do puzzle.
- Build de produção. Permanece o aviso de bundle acima de 500 kB, principalmente pelo Phaser.
- Chrome com APIs simuladas: 24 verificações de login, lobby, carteira e demo em telas de celular e desktop; outras 11 verificações do fluxo de jogador real, incluindo quebra antes da resposta, falha de resgate, repetição e saldo confirmado. Os cliques do segundo roteiro foram enviados como eventos DOM ao canvas devido a uma falha no encaminhamento de cliques pelo Chrome remoto. Nenhum dos roteiros registrou exceções JavaScript.
- Chrome nesta atualização: botão oculto com quatro limpezas, quinta limpeza imediata liberando resgate, falha de gravação demo preservada e reenviada ao retornar ao lobby, um único registro e saldo inalterado. Interface verificada em celular e desktop, sem exceções JavaScript.

A aplicação da migração em produção e a integração com pagamentos reais são etapas externas aos testes locais. Siga [as instruções de atualização](../backend/db/migrations/README.md). Não houve criação de depósitos, saques ou apostas em contas reais para testar estas alterações.

Pontos preexistentes que continuam exigindo atenção na operação da carteira:

1. O arquivo completo [schema.sql](../backend/db/schema.sql) contém uma reconciliação que recalcula saldos não administrativos. Para esta atualização, execute somente a migração incremental. Ela também revoga a execução pública da RPC de saldo, mantendo o acesso pelo backend com `service_role`.
2. Fluxos antigos de carteira permitem gravações separadas quando `REQUIRE_WALLET_LEDGER=false`. Configure `true` em produção. O novo puzzle exige transações independentemente dessa variável.
3. Reserva de saque, criação da solicitação e comunicação com o provedor ainda não formam uma única operação transacional. A configuração do callback é validada antes da reserva, mas falhas de inserção ou transporte ainda exigem reconciliação operacional; um timeout não confirma o resultado de uma transferência.

[sereia-GDD.md](../sereia-GDD.md), [sereia-do-tesouro.html](../sereia-do-tesouro.html), [write_files.py](../write_files.py), [game/src/runner](../game/src/runner) e os objetos da sereia são referências ou implementações legadas, fora da entrada ativa do Vite. Não use o gerador antigo para recriar as cenas atuais. As chaves `sereia_*` de sessão, atribuição, tutorial e som foram preservadas para manter os dados locais existentes.
