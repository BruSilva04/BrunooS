-- Persistent test credit, isolated from the real wallet and its ledger.
-- Requires 20260914_block_cashout_history.sql. Existing test history is retained.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS demo_balance numeric(14,2) NOT NULL DEFAULT 100
    CHECK (demo_balance >= 0 AND demo_balance::text NOT IN ('NaN','Infinity','-Infinity'));

CREATE TABLE IF NOT EXISTS public.block_demo_stakes (
    round_id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES public.users(id),
    bet numeric(12,2) NOT NULL CHECK (bet IN (30,50,100,200,500)),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS block_demo_stakes_user_idx ON public.block_demo_stakes(user_id);
ALTER TABLE public.block_demo_stakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.block_demo_stakes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.block_demo_stakes TO service_role;

CREATE OR REPLACE FUNCTION public.start_block_demo_round(p_user_id uuid, p_round_id uuid, p_bet numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_stake public.block_demo_stakes%ROWTYPE;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE id=p_user_id FOR UPDATE;
    IF NOT FOUND OR NOT (v_user.role='admin' OR COALESCE(v_user.permissions->'admin'='true'::jsonb,false)) THEN
        RETURN jsonb_build_object('ok',false,'reason','not_found');
    END IF;
    IF p_round_id IS NULL OR p_bet IS NULL OR p_bet NOT IN (30,50,100,200,500) THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid');
    END IF;
    IF EXISTS (SELECT 1 FROM public.block_demo_rounds WHERE round_id=p_round_id) THEN
        RETURN jsonb_build_object('ok',false,'reason','conflict');
    END IF;
    SELECT * INTO v_stake FROM public.block_demo_stakes WHERE round_id=p_round_id;
    IF FOUND THEN
        IF v_stake.user_id<>p_user_id OR v_stake.bet<>p_bet THEN
            RETURN jsonb_build_object('ok',false,'reason','conflict');
        END IF;
        RETURN jsonb_build_object('ok',true,'balance',v_user.demo_balance);
    END IF;
    IF v_user.demo_balance<p_bet THEN
        RETURN jsonb_build_object('ok',false,'reason','insufficient_balance');
    END IF;
    INSERT INTO public.block_demo_stakes(round_id,user_id,bet) VALUES(p_round_id,p_user_id,p_bet)
        ON CONFLICT(round_id) DO NOTHING;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok',false,'reason','conflict');
    END IF;
    UPDATE public.users SET demo_balance=demo_balance-p_bet WHERE id=p_user_id
        RETURNING * INTO v_user;
    RETURN jsonb_build_object('ok',true,'balance',v_user.demo_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_block_demo_round(
    p_user_id uuid, p_round_id uuid, p_bet numeric, p_status text,
    p_moves integer, p_total_clears integer, p_best_combo integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_stake public.block_demo_stakes%ROWTYPE;
    v_round public.block_demo_rounds%ROWTYPE;
    v_multiplier numeric;
    v_payout numeric;
    v_has_stake boolean;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE id=p_user_id FOR UPDATE;
    IF NOT FOUND OR NOT (v_user.role='admin' OR COALESCE(v_user.permissions->'admin'='true'::jsonb,false)) THEN
        RETURN jsonb_build_object('ok',false,'reason','not_found');
    END IF;
    IF p_round_id IS NULL OR p_bet IS NULL OR p_bet NOT IN (30,50,100,200,500)
       OR p_status IS NULL OR p_status NOT IN ('won','lost')
       OR p_moves IS NULL OR p_moves NOT BETWEEN 1 AND 100000
       OR p_total_clears IS NULL OR p_total_clears NOT BETWEEN 0 AND p_moves*16
       OR p_best_combo IS NULL OR p_best_combo NOT BETWEEN 0 AND LEAST(16,p_total_clears)
       OR (p_status='won' AND p_total_clears<5) THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid');
    END IF;
    SELECT * INTO v_round FROM public.block_demo_rounds WHERE round_id=p_round_id;
    IF FOUND THEN
        IF v_round.user_id<>p_user_id OR v_round.bet<>p_bet OR v_round.status<>p_status
           OR v_round.moves<>p_moves OR v_round.total_clears<>p_total_clears
           OR v_round.best_combo<>p_best_combo THEN
            RETURN jsonb_build_object('ok',false,'reason','conflict');
        END IF;
        RETURN jsonb_build_object('ok',true,'round_id',p_round_id,'balance',v_user.demo_balance);
    END IF;
    SELECT * INTO v_stake FROM public.block_demo_stakes WHERE round_id=p_round_id;
    v_has_stake := FOUND;
    IF v_has_stake AND (v_stake.user_id<>p_user_id OR v_stake.bet<>p_bet) THEN
        RETURN jsonb_build_object('ok',false,'reason','conflict');
    END IF;
    v_multiplier := LEAST(8,round((1000+p_total_clears*320+p_moves*25)::numeric/1000,2));
    v_payout := CASE WHEN p_status='won' THEN round(p_bet*v_multiplier,2) ELSE 0 END;
    INSERT INTO public.block_demo_rounds(round_id,user_id,bet,status,moves,total_clears,best_combo,multiplier,payout)
        VALUES(p_round_id,p_user_id,p_bet,p_status,p_moves,p_total_clears,p_best_combo,v_multiplier,v_payout)
        ON CONFLICT(round_id) DO NOTHING;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok',false,'reason','conflict');
    END IF;
    -- Results queued by an older client remain history-only: no unreserved credit.
    IF v_has_stake THEN
        UPDATE public.users SET demo_balance=demo_balance+v_payout WHERE id=p_user_id
            RETURNING * INTO v_user;
    END IF;
    RETURN jsonb_build_object('ok',true,'round_id',p_round_id,'balance',v_user.demo_balance);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_block_demo_deposit(p_user_id uuid, p_intent_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_user public.users%ROWTYPE;
    v_intent public.payment_intents%ROWTYPE;
BEGIN
    SELECT * INTO v_user FROM public.users WHERE id=p_user_id FOR UPDATE;
    IF NOT FOUND OR NOT (v_user.role='admin' OR COALESCE(v_user.permissions->'admin'='true'::jsonb,false)) THEN
        RETURN jsonb_build_object('ok',false,'reason','not_found');
    END IF;
    SELECT * INTO v_intent FROM public.payment_intents WHERE id=p_intent_id FOR UPDATE;
    IF NOT FOUND OR v_intent.user_id<>p_user_id::text OR v_intent.provider<>'sandbox' THEN
        RETURN jsonb_build_object('ok',false,'reason','not_found');
    END IF;
    IF v_intent.status='paid' THEN
        RETURN jsonb_build_object('ok',true,'intent',to_jsonb(v_intent),'balance',v_user.demo_balance);
    END IF;
    IF v_intent.status<>'pending' OR v_intent.amount<=0 OR v_intent.amount IS NULL
       OR v_intent.amount::text IN ('NaN','Infinity','-Infinity') THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid');
    END IF;
    UPDATE public.users SET demo_balance=demo_balance+round(v_intent.amount::numeric,2) WHERE id=p_user_id
        RETURNING * INTO v_user;
    UPDATE public.payment_intents SET status='paid',updated_at=now(),
        metadata=COALESCE(metadata,'{}'::jsonb)||'{"demo_balance_credit":true}'::jsonb
        WHERE id=p_intent_id RETURNING * INTO v_intent;
    RETURN jsonb_build_object('ok',true,'intent',to_jsonb(v_intent),'balance',v_user.demo_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.start_block_demo_round(uuid,uuid,numeric),
    public.settle_block_demo_round(uuid,uuid,numeric,text,integer,integer,integer),
    public.confirm_block_demo_deposit(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_block_demo_round(uuid,uuid,numeric),
    public.settle_block_demo_round(uuid,uuid,numeric,text,integer,integer,integer),
    public.confirm_block_demo_deposit(uuid,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
