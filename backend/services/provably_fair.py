import hashlib
import hmac
import secrets

def generate_server_seed() -> str:
    """Generate a random 32-byte hex seed."""
    return secrets.token_hex(32)

def hash_seed(seed: str) -> str:
    """SHA-256 hash of the seed (sent to client before round)."""
    return hashlib.sha256(seed.encode()).hexdigest()

def generate_hmac(server_seed: str, message: str) -> str:
    """HMAC-SHA256 of server_seed with message (round_id)."""
    return hmac.new(server_seed.encode(), message.encode(), hashlib.sha256).hexdigest()

def verify_seed(server_seed: str, expected_hash: str) -> bool:
    """Client-side verification: hash(seed) == expected_hash."""
    return hash_seed(server_seed) == expected_hash
