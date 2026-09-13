-- Apply once to the existing database. This migration does not reset balances.
BEGIN;

ALTER TABLE public.rounds
    ADD COLUMN IF NOT EXISTS game_type text NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS game_state jsonb,
    ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_action_id text;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_block_round_per_user
    ON public.rounds (user_id) WHERE game_type = 'block' AND status = 'active';

-- Monetary RPCs must be callable only by the trusted backend.
REVOKE EXECUTE ON FUNCTION public.adjust_wallet_balance(
    text, double precision, text, text, text, text, jsonb, double precision, double precision
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_block_round(
    p_user_id text, p_round_id text, p_bet double precision, p_state jsonb,
    p_server_seed text, p_seed_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_round public.rounds%ROWTYPE;
    v_wallet record;
BEGIN
    IF p_bet NOT IN (30, 50, 100, 200, 500) OR p_bet IS NULL OR p_state IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid');
    END IF;
    SELECT * INTO v_user FROM public.users WHERE id::text = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT * INTO v_round FROM public.rounds WHERE round_id = p_round_id;
    IF FOUND THEN
        IF v_round.user_id <> p_user_id OR v_round.game_type <> 'block' THEN
            RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
        END IF;
        RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_user.balance);
    END IF;
    -- Reopening the page or another tab resumes the reserved round.
    SELECT * INTO v_round FROM public.rounds
      WHERE user_id = p_user_id AND game_type = 'block' AND status = 'active';
    IF FOUND THEN
        RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_user.balance);
    END IF;
    SELECT * INTO v_wallet FROM public.adjust_wallet_balance(
        p_user_id, -p_bet, 'bet', 'round', p_round_id, 'block:bet:' || p_round_id,
        jsonb_build_object('game', 'block'), 0, 0
    );
    IF NOT v_wallet.ok THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
    END IF;
    INSERT INTO public.rounds (
        round_id, user_id, bet, crash_point, payout, server_seed, server_seed_hash,
        status, game_type, game_state, version
    ) VALUES (
        p_round_id, p_user_id, p_bet, 1, 0, p_server_seed, p_seed_hash,
        'active', 'block', p_state, 0
    ) RETURNING * INTO v_round;
    RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_wallet.balance);
END;
$$;

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
        IF p_state <> v_round.game_state OR COALESCE((p_state->>'total_clears')::integer, 0) < 3
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

CREATE OR REPLACE FUNCTION public.read_block_round(p_user_id text, p_round_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_round public.rounds%ROWTYPE;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE id::text = p_user_id FOR SHARE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    SELECT * INTO v_round FROM public.rounds
      WHERE round_id = p_round_id AND user_id = p_user_id AND game_type = 'block';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
    RETURN jsonb_build_object('ok', true, 'round', to_jsonb(v_round), 'balance', v_user.balance);
END;
$$;

REVOKE ALL ON FUNCTION public.read_block_round(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_block_round(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.start_block_round(text, text, double precision, jsonb, text, text)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_block_round(text, text, text, integer, jsonb, text, bigint)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_block_round(text, text, double precision, jsonb, text, text)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_block_round(text, text, text, integer, jsonb, text, bigint)
    TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
