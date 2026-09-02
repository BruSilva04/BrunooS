from .provably_fair import generate_hmac

HOUSE_EDGE = 0.05  # 5% house edge → 95% RTP

def generate_crash_point(server_seed: str, round_id: str) -> float:
    """
    Generate a crash point using provably fair HMAC.
    
    Formula: crash = max(1.0, (1 - HOUSE_EDGE) / (1 - r))
    where r is derived from HMAC hash, r ∈ [0, 1)
    
    Distribution ensures that:
    - ~5% of rounds crash at 1.00× (instant loss)
    - Median crash ~1.39×
    - Mean crash → RTP of 95%
    """
    hmac_hex = generate_hmac(server_seed, round_id)
    
    # Use first 13 hex chars (52 bits) for high precision
    h = int(hmac_hex[:13], 16)
    max_val = 16**13  # 2^52
    
    # r ∈ [0, 1) uniformly distributed
    r = h / max_val
    
    # 5% chance of instant crash (house edge)
    if r < HOUSE_EDGE:
        return 1.00
    
    # Crash point formula: ensures E[min(1, 1/crash)] = 1 - HOUSE_EDGE
    crash = (1 - HOUSE_EDGE) / (1 - r)
    
    # Round to 2 decimal places, minimum 1.01 if not instant crash
    crash = round(crash, 2)
    return max(1.01, crash)

def calculate_payout(bet: float, cash_out_mult: float, crash_point: float) -> tuple[bool, float]:
    """
    Calculate payout. Returns (success, payout_amount).
    Cash out is valid only if cash_out_mult <= crash_point.
    """
    if cash_out_mult <= crash_point:
        payout = round(bet * cash_out_mult, 2)
        return True, payout
    return False, 0.0
