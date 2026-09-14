"""Authoritative puzzle rules. Money is calculated in integer cents."""
from copy import deepcopy
import secrets

BOARD_SIZE = 8
ALLOWED_BETS_CENTS = {3000, 5000, 10000, 20000, 50000}
CASHOUT_CLEARS = 3
MAX_MULTIPLIER_HUNDREDTHS = 800
START_TIER = 2
MOVES_PER_TIER = 3
CLEARS_PER_TIER = 3

PIECE_DEFS = [
    ("single", 1, [[0, 0]], 0xffdf72),
    ("h2", 1, [[0, 0], [0, 1]], 0x8fffe7),
    ("v2", 1, [[0, 0], [1, 0]], 0x7dd3fc),
    ("h3", 1, [[0, 0], [0, 1], [0, 2]], 0xff9aa9),
    ("v3", 1, [[0, 0], [1, 0], [2, 0]], 0xf4c84a),
    ("square2", 1, [[0, 0], [0, 1], [1, 0], [1, 1]], 0x25e0a7),
    ("l3", 2, [[0, 0], [1, 0], [1, 1]], 0xb38cff),
    ("l3r", 2, [[0, 1], [1, 0], [1, 1]], 0xff8bb7),
    ("h4", 2, [[0, 0], [0, 1], [0, 2], [0, 3]], 0x65d3ff),
    ("v4", 2, [[0, 0], [1, 0], [2, 0], [3, 0]], 0x5dffd0),
    ("rect3x2", 2, [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], 0xf6c85f),
    ("t", 3, [[0, 0], [0, 1], [0, 2], [1, 1]], 0xff6675),
    ("z", 3, [[0, 0], [0, 1], [1, 1], [1, 2]], 0x9df8ff),
    ("zi", 3, [[0, 1], [0, 2], [1, 0], [1, 1]], 0xffdf72),
    ("l4", 3, [[0, 0], [1, 0], [2, 0], [2, 1]], 0x8d5cff),
    ("h5", 3, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], 0xffa85c),
    ("plus", 4, [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], 0xd7fbff),
    ("bigL", 4, [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]], 0xf472b6),
    ("corner5", 4, [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]], 0x22d3ee),
    ("v5", 3, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], 0xa78bfa),
    ("square3", 3, [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], 0x67e8f9),
    ("rect4x2", 4, [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3]], 0xf472b6),
]


def can_place(board, piece, row, col):
    return not piece.get("used") and all(
        0 <= row + dr < BOARD_SIZE and 0 <= col + dc < BOARD_SIZE
        and board[row + dr][col + dc] == 0
        for dr, dc in piece["coords"]
    )


def has_move(board, pieces):
    return any(can_place(board, piece, row, col)
               for piece in pieces if not piece.get("used")
               for row in range(BOARD_SIZE) for col in range(BOARD_SIZE))


def difficulty(total_clears, moves):
    return min(4, START_TIER + max(moves // MOVES_PER_TIER, total_clears // CLEARS_PER_TIER))


def generate_batch(board, tier, randbelow=secrets.randbelow):
    tier = max(START_TIER, min(4, tier))
    pool = [definition for definition in PIECE_DEFS if definition[1] <= tier and len(definition[2]) >= 3]

    def pick_weighted(candidates):
        ticket = randbelow(sum(len(item[2]) * (1 + item[1]) for item in candidates))
        for item in candidates:
            ticket -= len(item[2]) * (1 + item[1])
            if ticket < 0:
                return item

    def make_piece(definition):
        key, level, coords, color = definition
        return {"id": secrets.token_hex(12), "key": key, "label": key,
                "tier": level, "coords": deepcopy(coords), "color": color, "used": False}

    # Same policy as the admin demo: favor large shapes and include an initially
    # blocked shape whenever possible. Never reroll a rack to guarantee a move.
    blocked = [item for item in pool if not has_move(board, [{"coords": item[2]}])]
    selected = [pick_weighted(blocked or pool)]
    while len(selected) < 3:
        selected.append(pick_weighted([item for item in pool if item not in selected]))
    for index in range(len(selected) - 1, 0, -1):
        other = randbelow(index + 1)
        selected[index], selected[other] = selected[other], selected[index]
    return [make_piece(item) for item in selected]


def new_state():
    board = [[0] * BOARD_SIZE for _ in range(BOARD_SIZE)]
    tier = difficulty(0, 0)
    return {"board": board, "pieces": generate_batch(board, tier),
            "moves": 0, "total_clears": 0, "best_combo": 0, "difficulty_tier": tier}


def apply_move(state, piece_id, row, col):
    next_state = deepcopy(state)
    piece = next((piece for piece in next_state["pieces"] if piece["id"] == piece_id), None)
    if not piece or not can_place(next_state["board"], piece, row, col):
        raise ValueError("Jogada inválida. Atualize a rodada e tente novamente.")
    board = next_state["board"]
    for dr, dc in piece["coords"]:
        board[row + dr][col + dc] = 1
    rows = [r for r in range(BOARD_SIZE) if all(board[r])]
    columns = [c for c in range(BOARD_SIZE) if all(board[r][c] for r in range(BOARD_SIZE))]
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if r in rows or c in columns:
                board[r][c] = 0
    piece["used"] = True
    clears = len(rows) + len(columns)
    next_state["moves"] += 1
    next_state["total_clears"] += clears
    next_state["best_combo"] = max(next_state["best_combo"], clears)
    next_state["difficulty_tier"] = difficulty(next_state["total_clears"], next_state["moves"])
    if all(piece["used"] for piece in next_state["pieces"]):
        next_state["pieces"] = generate_batch(board, next_state["difficulty_tier"])
    return next_state, "active" if has_move(board, next_state["pieces"]) else "lost"


def multiplier_hundredths(state):
    # 1x + 0.32x per line/column + 0.025x per placement, rounded half up.
    thousandths = 1000 + state["total_clears"] * 320 + state["moves"] * 25
    return min(MAX_MULTIPLIER_HUNDREDTHS, (thousandths + 5) // 10)


def payout_cents(bet_cents, state):
    return (bet_cents * multiplier_hundredths(state) + 50) // 100
