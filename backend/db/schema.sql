CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL,
    email text NOT NULL UNIQUE,
    username text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'player',
    permissions jsonb NOT NULL DEFAULT '{"play": true, "admin": false}'::jsonb,
    balance double precision NOT NULL DEFAULT 250,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

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
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.rounds TO service_role;
GRANT ALL ON TABLE public.users TO service_role;
