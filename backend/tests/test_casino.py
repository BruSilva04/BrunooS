import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.provably_fair import generate_server_seed
from services.casino import calculate_payout, generate_crash_point
import uuid

def test_rtp_distribution():
    """Simulate 10,000 rounds and verify RTP is approximately 95%."""
    N = 10000
    total_bet = 0
    total_payout = 0
    crash_points = []
    instant_crashes = 0
    
    for _ in range(N):
        bet = 10.0
        total_bet += bet
        
        server_seed = generate_server_seed()
        round_id = str(uuid.uuid4())
        crash = generate_crash_point(server_seed, round_id)
        crash_points.append(crash)
        
        if crash <= 1.00:
            instant_crashes += 1
            continue
        
        # Simulate a player who always tries to cash out at 1.5x
        _, payout = calculate_payout(bet, 1.5, crash)
        total_payout += payout
    
    rtp = total_payout / total_bet
    avg_crash = sum(crash_points) / len(crash_points)
    
    print(f"Rounds: {N}")
    print(f"Total bet: R${total_bet:.2f}")
    print(f"Total payout: R${total_payout:.2f}")
    print(f"RTP (at 1.5x cashout): {rtp*100:.2f}%")
    print(f"Avg crash point: {avg_crash:.2f}x")
    print(f"Instant crashes (1.00x): {instant_crashes} ({instant_crashes/N*100:.1f}%)")
    print(f"Crash > 2x: {sum(1 for c in crash_points if c > 2)/ N*100:.1f}%")
    print(f"Crash > 5x: {sum(1 for c in crash_points if c > 5)/ N*100:.1f}%")
    print(f"Crash > 10x: {sum(1 for c in crash_points if c > 10)/ N*100:.1f}%")
    print(f"Max crash: {max(crash_points):.2f}x")
    
    # RTP should be close to 95% for any strategy
    # For 1.5x cashout, expected RTP ≈ (1-0.05) * proportion_reaching_1.5 * 1.5
    assert 0.80 < rtp < 1.10, f"RTP {rtp} is outside acceptable range"

if __name__ == "__main__":
    test_rtp_distribution()
