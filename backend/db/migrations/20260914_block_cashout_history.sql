-- Requires 20260912_block_rounds.sql. Does not recalculate or alter balances.
BEGIN;

CREATE TABLE IF NOT EXISTS public.block_demo_rounds (
    round_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    bet numeric(12, 2) NOT NULL CHECK (bet IN (30, 50, 100, 200, 500)),
    status text NOT NULL CHECK (status IN ('won', 'lost')),
    moves integer NOT NULL CHECK (moves > 0),
    total_clears integer NOT NULL CHECK (total_clears >= 0),
    best_combo integer NOT NULL CHECK (best_combo BETWEEN 0 AND 16),
    multiplier numeric(6, 2) NOT NULL CHECK (multiplier BETWEEN 1 AND 8),
    payout numeric(12, 2) NOT NULL CHECK (payout >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (best_combo <= total_clears),
    CHECK ((status = 'lost' AND payout = 0) OR (status = 'won' AND total_clears >= 5))
);
CREATE INDEX IF NOT EXISTS block_demo_rounds_user_created_idx
    ON public.block_demo_rounds (user_id, created_at DESC);
ALTER TABLE public.block_demo_rounds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.block_demo_rounds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.block_demo_rounds TO service_role;

CREATE OR REPLACE FUNCTION public.commit_block_round(
    p_user_id text, p_round_id text, p_action_id text, p_version integer,
    p_state jsonb, p_status text, p_payout_cents bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_round public.rounds%ROWTYPE;
    v_wallet record;
    v_balance double precision;
    v_multiplier numeric;
BEGIN
    -- Every transaction locks the wallet before the round, in the same order.
    SELECT * INTO v_user FROM public.users WHERE id::text = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT * INTO v_round FROM public.rounds
      WHERE round_id = p_round_id AND user_id = p_user_id AND game_type = 'block' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    IF p_action_id = v_round.last_action_id THEN
        RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_user.balance);
    END IF;
    IF v_round.status <> 'active' OR v_round.version <> p_version THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
    END IF;
    IF p_status NOT IN ('active', 'won', 'lost') OR p_status IS NULL
       OR p_payout_cents IS NULL OR p_payout_cents < 0 OR p_state IS NULL
       OR p_action_id IS NULL OR p_version IS NULL
       OR (p_status <> 'won' AND p_payout_cents <> 0) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
    END IF;
    v_balance := v_user.balance;
    v_multiplier := LEAST(8, round((1000 + (p_state->>'total_clears')::integer * 320
        + (p_state->>'moves')::integer * 25)::numeric / 1000, 2));
    IF p_status = 'won' THEN
        -- Cashout must use the persisted state; the caller cannot increase the board value.
        IF p_state <> v_round.game_state OR COALESCE((p_state->>'total_clears')::integer, 0) < 5
           OR p_payout_cents <> round(v_round.bet::numeric * v_multiplier * 100)::bigint THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
        END IF;
        SELECT * INTO v_wallet FROM public.adjust_wallet_balance(
            p_user_id, p_payout_cents::double precision / 100, 'payout', 'round', p_round_id,
            'block:payout:' || p_round_id, jsonb_build_object('game', 'block'), 0, 0
        );
        IF NOT v_wallet.ok THEN
            RAISE EXCEPTION 'Could not settle block payout';
        END IF;
        v_balance := v_wallet.balance;
    END IF;
    UPDATE public.rounds SET game_state = p_state, version = version + 1,
        last_action_id = p_action_id, status = p_status,
        payout = p_payout_cents::double precision / 100,
        cash_out_at = CASE WHEN p_status IN ('won', 'lost') THEN v_multiplier ELSE NULL END
      WHERE round_id = p_round_id RETURNING * INTO v_round;
    RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_lobby_snapshot(p_user_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_rounds jsonb;
BEGIN
    -- Real game settlements lock the wallet first, so history and balance agree.
    SELECT * INTO v_user FROM public.users WHERE id::text = p_user_id FOR SHARE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('user', NULL, 'rounds', '[]'::jsonb);
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC, round_id DESC), '[]'::jsonb)
      INTO v_rounds
      FROM (
        SELECT * FROM (
          SELECT round_id, bet, payout, status, cash_out_at, crash_point,
                 created_at, game_type, false AS demo_mode
            FROM public.rounds WHERE user_id = p_user_id
          UNION ALL
          SELECT round_id::text, bet::double precision, payout::double precision,
                 status, multiplier::double precision, 1::double precision,
                 created_at, 'block_demo'::text, true
            FROM public.block_demo_rounds WHERE user_id::text = p_user_id
        ) AS matches
        ORDER BY created_at DESC, round_id DESC LIMIT 100
      ) AS recent;
    RETURN jsonb_build_object('user', to_jsonb(v_user) - 'password_hash', 'rounds', v_rounds);
END;
$$;
REVOKE ALL ON FUNCTION public.read_lobby_snapshot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_lobby_snapshot(text) TO service_role;
REVOKE ALL ON FUNCTION public.commit_block_round(text, text, text, integer, jsonb, text, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_block_round(text, text, text, integer, jsonb, text, bigint)
    TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
