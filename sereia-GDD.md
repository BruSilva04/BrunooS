# 🧜‍♀️ Sereia do Tesouro — Casino Runner

> Jogo de cassino arcade mobile-first. Runner subaquático com mecânica de Cash Out.

---

## 📐 Game Design Document (GDD)

### Conceito Central
| Item | Descrição |
|---|---|
| Gênero | Arcade Runner + Crash Game (Cassino) |
| Plataforma | Web Mobile (PWA) |
| Público-alvo | Feminino, 20–35 anos, casual gamers |
| Sessão média | 30–90 segundos |

### Loop de Gameplay
```
1. Jogadora define aposta (R$2 / 5 / 10 / 20 / 50)
2. Sereia começa a nadar (runner side-scroll infinito)
3. Toque → impulso para cima | Soltar → gravidade puxa para baixo
4. Obstáculos vêm da direita com frequência crescente
5. 💎 Diamantes coletados = bônus no multiplicador (+0.07×)
6. Multiplicador base sobe +0.012× a cada 100ms
7. CASH OUT a qualquer momento = bet × mult → Pix
8. Morrer (bater em obstáculo/borda) = perde a aposta
```

### Obstáculos
| Emoji | Nome | Comportamento |
|---|---|---|
| 🦈 | Tubarão | Par com gap para passar |
| 🕸️ | Rede | Par com gap para passar |
| 🪤 | Armadilha | Par com gap para passar |
| 🦑 | Lula | (futuro: movimento vertical) |

### Mecânica de Cassino — RTP
```
RTP alvo: 95%
Multiplicador crash: gerado server-side com seed provably fair
Fórmula base: crash = 99 / (1 - r) onde r ∈ [0, 0.99)
House edge: 1 - (1/crash_médio) ≈ 5%
```

### Progressão de Dificuldade
| Multiplicador | Velocidade | Intervalo obstáculo |
|---|---|---|
| 1.0× – 2.5× | 170–248 px/s | 2000ms |
| 2.5× – 4.0× | 248–318 px/s | 1400ms |
| 4.0×+ | 318+ px/s | 1100ms |

---

## 🗂️ Estrutura do Projeto (Target)

```
sereia-do-tesouro/
│
├── index.html              ← PROTÓTIPO (v0 — Phaser via CDN)
├── README.md
│
├── /frontend               ← React (Lobby, Wallet, Histórico)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Lobby.jsx       ← lista de jogos / saldo
│   │   │   ├── Game.jsx        ← wrapper do Phaser
│   │   │   └── History.jsx     ← histórico de apostas
│   │   ├── components/
│   │   │   ├── BetPanel.jsx
│   │   │   ├── WalletBar.jsx
│   │   │   └── CashOutBtn.jsx
│   │   └── hooks/
│   │       ├── useWallet.js
│   │       └── useGame.js      ← WebSocket com backend
│
├── /game                   ← Phaser (módulos ES)
│   ├── main.js
│   ├── config.js
│   ├── scenes/
│   │   ├── BootScene.js        ← preload assets
│   │   ├── MenuScene.js
│   │   └── GameScene.js
│   └── objects/
│       ├── Mermaid.js
│       ├── Obstacle.js
│       └── Pearl.js
│
├── /backend                ← FastAPI (Python)
│   ├── main.py
│   ├── routers/
│   │   ├── auth.py
│   │   ├── game.py             ← WebSocket da partida
│   │   └── payments.py         ← Pix (Gerencianet/MP)
│   ├── models/
│   │   ├── user.py
│   │   └── round.py
│   ├── services/
│   │   ├── casino.py           ← RTP, crash point, seed
│   │   └── pix.py
│   └── db/
│       └── schema.sql
│
└── /assets                 ← (futuro) spritesheets, sons, música
    ├── sprites/
    ├── audio/
    └── fonts/
```

---

## 🛠️ Stack Técnica

| Camada | Tecnologia | Motivo |
|---|---|---|
| Motor do jogo | **Phaser.js 3** | Runner web, mobile, 60fps |
| Frontend | **React + Vite** | Lobby, carteira, histórico |
| Backend | **FastAPI (Python)** | Async, WebSocket nativo |
| Comunicação | **WebSocket** | Partida em tempo real |
| Banco | **PostgreSQL** | Rounds, usuários, saldo |
| Pagamento | **Gerencianet / MP** | Pix + cobrança |
| Anti-cheat | Seed server-side | Crash point gerado antes da partida |
| Deploy | **Vercel** (front) + **Railway/Fly.io** (back) | Rápido e barato |

---

## 🚦 Roadmap

### v0 — Protótipo (AGORA)
- [x] Mecânica core jogável (index.html)
- [x] Multiplier + Cash Out + Game Over
- [x] Dificuldade crescente
- [ ] Testar em mobile real

### v1 — Backend + Pix
- [ ] FastAPI + WebSocket para partidas
- [ ] Sistema de seed provably fair
- [ ] Integração Pix (depósito / saque)
- [ ] Cadastro + autenticação JWT

### v2 — Arte + Polimento
- [ ] Spritesheets animados (sereia, obstáculos)
- [ ] Música / SFX oceânicos
- [ ] Efeitos de partícula (bolhas, brilhos)
- [ ] Tema bioluminescente nas profundezas

### v3 — Monetização + Retenção
- [ ] Torneio diário (seed compartilhado)
- [ ] Ranking semanal
- [ ] Missões diárias (ex: "colete 5 diamantes")
- [ ] Vidas extras comprável

---

## ⚠️ Compliance

- Regulação de jogos de azar online no Brasil está em tramitação (Lei 14.790/2023)
- Verificar requisitos da Secretaria de Prêmios e Apostas (SPA/MF)
- RTP mínimo exigido: 85% (verificar regulamentação vigente)
- KYC obrigatório para saques acima de R$ 2.000
- Integração com lista PEP e LGPD
