Revisão do projeto — Block Rush — 12/09/2026

O frontend ativo usa Vite e Phaser, com entrada em [game/index.html:79](../game/index.html#L79) e cenas registradas em [game/src/main.js:22](../game/src/main.js#L22): carregamento, autenticação, lobby, administração, seleção de valor e jogo. A identidade atual está centralizada em [game/src/brand.js](../game/src/brand.js) e [game/src/brand.css](../game/src/brand.css).

O jogo atual é um puzzle demo de tabuleiro 8×8, três peças por lote e resgate visual após três limpezas. [GameScene.js:106](../game/src/scenes/GameScene.js#L106) inicia a rodada local; [config.js:32](../game/src/config.js#L32) define as regras. Essa cena não abre o WebSocket financeiro nem debita ou credita saldo real. Seus resultados também não são persistidos no histórico financeiro da conta.

O backend FastAPI mantém autenticação, carteira, Pix, aquisição de usuários e relatórios em Supabase. O endpoint [backend/routers/game.py:103](../backend/routers/game.py#L103) continua implementando o modelo anterior de crash/cashout, com reserva e liquidação de saldo. A existência desse endpoint não representa integração financeira do puzzle. Carteira e histórico continuam sendo funções da plataforma; a demo não cumpre rollover.

[sereia-GDD.md](../sereia-GDD.md), [sereia-do-tesouro.html](../sereia-do-tesouro.html), [write_files.py](../write_files.py), [game/src/runner](../game/src/runner) e os objetos da sereia são referências ou implementações legadas, fora da entrada ativa do Vite. O gerador `write_files.py` contém gravações de cenas antigas e não deve ser usado para regenerar a interface atual.

As chaves `sereia_*` de sessão, atribuição e preferência de som foram preservadas em [api.js:3](../game/src/services/api.js#L3) e [SoundManager.js:4](../game/src/utils/SoundManager.js#L4). Também permanecem os identificadores internos de produto/provedor em [amplopay.py:79](../backend/services/amplopay.py#L79) e o email administrativo padrão em [database.py:115](../backend/db/database.py#L115). Renomeá-los exige avaliar dados existentes e integrações; o nome visível do produto Pix já acompanha Block Rush.

Verificações executadas nesta revisão:

| Verificação | Resultado |
| --- | --- |
| `python3 backend/tests/test_casino.py` | Passou: simulação de 10.000 rodadas do motor anterior. |
| `cd game && npm test` | Passou: regras do puzzle, mensagens de erro/status da API e preservação das sessões e atribuição. |
| `cd game && npm run build` | Passou. Permanece o aviso de bundle acima de 500 kB, principalmente pelo Phaser. |
| Chrome com API simulada | 25 verificações da aplicação passaram em 390×844, 320×740 e 1440×1000, sem exceções JavaScript. Login/cadastro e lobby tiveram ainda 18 verificações isoladas cada. |
| `python3 backend/tests/test_tracking.py` | Passou: normalização, token de atribuição e métricas. |
| Análise sintática Python | Os 21 arquivos do backend foram analisados sem erros. |
| `python3 backend/tests/test_wallet_rules.py` | A execução completa parou na importação por ausência de `anyio` no Python local. |
| Regras puras de carteira | As três funções de teste existentes passaram com as funções de bônus/rollover extraídas por AST, sem carregar dependências de banco. Isso não valida importação ou integração com Supabase. |

Achados preexistentes para uma revisão financeira posterior. São observações do código local; privilégios, variáveis de ambiente, dados e comportamento dos serviços em produção não foram consultados ou testados:

1. **Permissões da RPC de carteira.** [schema.sql:361](../backend/db/schema.sql#L361) declara `adjust_wallet_balance` como `SECURITY DEFINER`, e [schema.sql:485](../backend/db/schema.sql#L485) concede execução a `service_role`, sem revogar explicitamente `PUBLIC`, `anon` ou `authenticated`. O script, isoladamente, não assegura execução exclusiva pelo backend. A exposição efetiva depende dos privilégios/defaults do banco instalado. Conferir esses privilégios e explicitar a restrição na migração.
2. **Reaplicação do schema altera saldos.** [schema.sql:497](../backend/db/schema.sql#L497) recalcula o saldo de todos os usuários não administrativos pela soma do ledger, usando zero quando não há registros. A instrução roda sempre que o arquivo é aplicado. Separar essa reconciliação da criação de schema e avaliar a integridade do histórico antes de executá-la sobre dados existentes.
3. **Fallback financeiro sem transação conjunta.** [database.py:619](../backend/db/database.py#L619) define `REQUIRE_WALLET_LEDGER=false` por padrão. Quando a RPC falha, [database.py:703](../backend/db/database.py#L703) permite ler/atualizar saldo e registrar o ledger separadamente. A análise indica possibilidade de inconsistência sob concorrência ou falha parcial; não houve reprodução contra banco real. Verificar a configuração instalada e preferir a RPC transacional com falha explícita.
4. **Reserva de saque e tratamento de falhas.** [database.py:954](../backend/db/database.py#L954) reserva saldo antes de inserir a solicitação em [database.py:985](../backend/db/database.py#L985). Depois, [wallet.py:383](../backend/routers/wallet.py#L383) resolve a URL do callback, mas o fluxo de restituição captura apenas `AmploPayError` em [wallet.py:385](../backend/routers/wallet.py#L385). Falhas de configuração, inserção ou transporte em [amplopay.py:30](../backend/services/amplopay.py#L30) podem deixar uma reserva sem conclusão. Validar configuração antes da reserva e projetar reconciliação idempotente; um timeout não confirma se o provedor efetuou a transferência.

A expiração de sessão agora também encerra `AdminDashboard`, junto das demais cenas autenticadas, em [game/src/main.js:61](../game/src/main.js#L61). Os achados financeiros acima foram documentados sem alterar regras financeiras ou executar migrações, depósitos, saques ou chamadas a serviços externos nesta revisão.

O controle de sessão também aguarda uma cena autenticada ficar ativa antes de redirecionar, evitando disputar a inicialização com `Boot`. Falhas temporárias ao carregar o lobby mantêm a sessão e permitem tentar novamente; uma resposta 401 exige novo acesso.
