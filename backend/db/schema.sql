CREATE TABLE IF NOT EXISTS public.rounds (
    round_id text PRIMARY KEY,
    user_id text NOT NULL DEFAULT 'anonymous',
    bet double precision NOT NULL,
    crash_point double precision NOT NULL,
    cash_out_at double precision,
    payout double precision NOT NULL DEFAULT 0,
    server_seed text NOT NULL,
    server_seed_hash text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rounds_created_at_idx ON public.rounds (created_at DESC);
CREATE INDEX IF NOT EXISTS rounds_user_id_idx ON public.rounds (user_id);

ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.rounds TO service_role;
