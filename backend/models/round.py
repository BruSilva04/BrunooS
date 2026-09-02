from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class RoundCreate(BaseModel):
    bet: float
    user_id: str = 'anonymous'

class Round(BaseModel):
    round_id: str
    user_id: str
    bet: float
    crash_point: float
    cash_out_at: Optional[float] = None
    payout: float = 0.0
    server_seed: str
    server_seed_hash: str
    status: str = 'active'
    created_at: Optional[datetime] = None
