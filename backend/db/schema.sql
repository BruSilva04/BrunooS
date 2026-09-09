CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL,
    email text NOT NULL UNIQUE,
    username text NOT NULL UNIQUE,
    legal_name text,
    document text,
    document_type text NOT NULL DEFAULT 'cpf',
    password_hash text NOT NULL,
    role text NOT NULL DEFAULT 'player',
    permissions jsonb NOT NULL DEFAULT '{"play": true, "admin": false}'::jsonb,
    balance double precision NOT NULL DEFAULT 0,
    bonus_balance double precision NOT NULL DEFAULT 0,
    rollover_required double precision NOT NULL DEFAULT 0,
    rollover_progress double precision NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
CREATE INDEX IF NOT EXISTS users_email_idx ON public.users (email);

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS legal_name text,
    ADD COLUMN IF NOT EXISTS document text,
    ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'cpf',
    ADD COLUMN IF NOT EXISTS bonus_balance double precision NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rollover_required double precision NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rollover_progress double precision NOT NULL DEFAULT 0;

ALTER TABLE public.users
    ALTER COLUMN balance SET DEFAULT 0,
    ALTER COLUMN bonus_balance SET DEFAULT 0,
    ALTER COLUMN rollover_required SET DEFAULT 0,
    ALTER COLUMN rollover_progress SET DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS users_document_idx
    ON public.users (document)
    WHERE document IS NOT NULL AND document <> '';

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

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    transaction_type text NOT NULL,
    amount double precision NOT NULL,
    balance_after double precision NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    reference_type text,
    reference_id text,
    idempotency_key text UNIQUE,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wallet_transactions_user_created_idx
    ON public.wallet_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_transactions_reference_idx
    ON public.wallet_transactions (reference_type, reference_id);

CREATE TABLE IF NOT EXISTS public.payment_intents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    provider text NOT NULL DEFAULT 'sandbox',
    provider_payment_id text,
    amount double precision NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    pix_qr_code text,
    pix_copy_paste text,
    expires_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_intents_user_created_idx
    ON public.payment_intents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_provider_payment_idx
    ON public.payment_intents (provider, provider_payment_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_provider_payment_unique_idx
    ON public.payment_intents (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL AND provider_payment_id <> '';

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    amount double precision NOT NULL,
    pix_key text NOT NULL,
    pix_key_type text NOT NULL DEFAULT 'random',
    owner_name text,
    owner_document text,
    owner_document_type text,
    status text NOT NULL DEFAULT 'requested',
    provider_transfer_id text,
    reviewed_by text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS withdrawal_requests_user_created_idx
    ON public.withdrawal_requests (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_requests_provider_transfer_unique_idx
    ON public.withdrawal_requests (provider_transfer_id)
    WHERE provider_transfer_id IS NOT NULL AND provider_transfer_id <> '';

ALTER TABLE public.withdrawal_requests
    ADD COLUMN IF NOT EXISTS owner_name text,
    ADD COLUMN IF NOT EXISTS owner_document text,
    ADD COLUMN IF NOT EXISTS owner_document_type text;

CREATE TABLE IF NOT EXISTS public.operator_settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by text NOT NULL,
    amount double precision NOT NULL,
    pix_key text,
    pix_key_type text,
    owner_name text,
    owner_document text,
    owner_document_type text,
    provider_transfer_id text,
    status text NOT NULL DEFAULT 'requested',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    paid_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operator_settlements_created_idx
    ON public.operator_settlements (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS operator_settlements_provider_transfer_unique_idx
    ON public.operator_settlements (provider_transfer_id)
    WHERE provider_transfer_id IS NOT NULL AND provider_transfer_id <> '';

ALTER TABLE public.operator_settlements
    ADD COLUMN IF NOT EXISTS pix_key text,
    ADD COLUMN IF NOT EXISTS pix_key_type text,
    ADD COLUMN IF NOT EXISTS owner_name text,
    ADD COLUMN IF NOT EXISTS owner_document text,
    ADD COLUMN IF NOT EXISTS owner_document_type text,
    ADD COLUMN IF NOT EXISTS provider_transfer_id text;

ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_settlements ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.rounds TO service_role;
GRANT ALL ON TABLE public.users TO service_role;
GRANT ALL ON TABLE public.wallet_transactions TO service_role;
GRANT ALL ON TABLE public.payment_intents TO service_role;
GRANT ALL ON TABLE public.withdrawal_requests TO service_role;
GRANT ALL ON TABLE public.operator_settlements TO service_role;

DROP FUNCTION IF EXISTS public.adjust_wallet_balance(
    text,
    double precision,
    text,
    text,
    text,
    text,
    jsonb,
    double precision,
    double precision
);

DROP FUNCTION IF EXISTS public.adjust_wallet_balance(
    text,
    double precision,
    text,
    text,
    text,
    text,
    jsonb
);

CREATE OR REPLACE FUNCTION public.adjust_wallet_balance(
    p_user_id text,
    p_delta double precision,
    p_transaction_type text DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_reference_id text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_rollover_required_delta double precision DEFAULT 0,
    p_bonus_delta double precision DEFAULT 0
)
RETURNS TABLE(ok boolean, balance double precision, transaction_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_existing public.wallet_transactions%ROWTYPE;
    v_transaction public.wallet_transactions%ROWTYPE;
    v_new_balance double precision;
    v_new_bonus_balance double precision;
    v_new_rollover_required double precision;
    v_new_rollover_progress double precision;
    v_bonus_delta_effective double precision;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT *
        INTO v_existing
        FROM public.wallet_transactions
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            ok := true;
            balance := v_existing.balance_after;
            transaction_id := v_existing.id;
            RETURN NEXT;
            RETURN;
        END IF;
    END IF;

    SELECT *
    INTO v_user
    FROM public.users
    WHERE id::text = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        ok := false;
        balance := 0;
        transaction_id := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    v_new_balance := round((COALESCE(v_user.balance, 0) + p_delta)::numeric, 2)::double precision;
    v_bonus_delta_effective := COALESCE(p_bonus_delta, 0);
    IF p_delta < 0 AND p_transaction_type IN ('bet', 'withdrawal_hold') THEN
        v_bonus_delta_effective := v_bonus_delta_effective - LEAST(COALESCE(v_user.bonus_balance, 0), ABS(p_delta));
    END IF;

    v_new_bonus_balance := round(GREATEST(0, COALESCE(v_user.bonus_balance, 0) + v_bonus_delta_effective)::numeric, 2)::double precision;
    v_new_rollover_required := round(GREATEST(0, COALESCE(v_user.rollover_required, 0) + COALESCE(p_rollover_required_delta, 0))::numeric, 2)::double precision;
    v_new_rollover_progress := round(COALESCE(v_user.rollover_progress, 0)::numeric, 2)::double precision;

    IF p_transaction_type = 'bet' AND p_delta < 0 AND v_new_rollover_progress < v_new_rollover_required THEN
        v_new_rollover_progress := round(LEAST(v_new_rollover_required, v_new_rollover_progress + ABS(p_delta))::numeric, 2)::double precision;
    END IF;

    IF v_new_balance < 0 THEN
        ok := false;
        balance := COALESCE(v_user.balance, 0);
        transaction_id := NULL;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE public.users
    SET balance = v_new_balance,
        bonus_balance = v_new_bonus_balance,
        rollover_required = v_new_rollover_required,
        rollover_progress = v_new_rollover_progress,
        updated_at = now()
    WHERE id = v_user.id;

    IF p_transaction_type IS NOT NULL AND round(p_delta::numeric, 2) <> 0 THEN
        INSERT INTO public.wallet_transactions (
            user_id,
            transaction_type,
            amount,
            balance_after,
            status,
            reference_type,
            reference_id,
            idempotency_key,
            metadata
        )
        VALUES (
            p_user_id,
            p_transaction_type,
            round(p_delta::numeric, 2)::double precision,
            v_new_balance,
            'completed',
            p_reference_type,
            p_reference_id,
            p_idempotency_key,
            COALESCE(p_metadata, '{}'::jsonb)
        )
        RETURNING * INTO v_transaction;
    END IF;

    ok := true;
    balance := v_new_balance;
    transaction_id := v_transaction.id;
    RETURN NEXT;
EXCEPTION
    WHEN unique_violation THEN
        IF p_idempotency_key IS NOT NULL THEN
            SELECT *
            INTO v_existing
            FROM public.wallet_transactions
            WHERE idempotency_key = p_idempotency_key
            LIMIT 1;

            IF FOUND THEN
                ok := true;
                balance := v_existing.balance_after;
                transaction_id := v_existing.id;
                RETURN NEXT;
                RETURN;
            END IF;
        END IF;
        RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_wallet_balance(
    text,
    double precision,
    text,
    text,
    text,
    text,
    jsonb,
    double precision,
    double precision
) TO service_role;

UPDATE public.users AS u
SET balance = GREATEST(0, COALESCE((
    SELECT round(sum(wt.amount)::numeric, 2)::double precision
    FROM public.wallet_transactions AS wt
    WHERE wt.user_id = u.id::text
      AND wt.status = 'completed'
), 0))
WHERE COALESCE(u.role, 'player') <> 'admin';

NOTIFY pgrst, 'reload schema';
