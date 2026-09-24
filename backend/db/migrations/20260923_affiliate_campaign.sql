-- Create the influencer and her first campaign in one transaction.
-- Adds the acquisition tables and attribution columns when absent. Safe to reapply.
-- Requires the existing users and payment_intents tables.
-- No wallet, user balance or commission is created or modified.
BEGIN;

CREATE TABLE IF NOT EXISTS public.affiliates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    handle text,
    contact text,
    status text NOT NULL DEFAULT 'active',
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS affiliates_status_idx ON public.affiliates (status);
CREATE INDEX IF NOT EXISTS affiliates_handle_idx ON public.affiliates (handle);

CREATE TABLE IF NOT EXISTS public.campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    affiliate_id uuid NOT NULL,
    name text NOT NULL,
    referral_code text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    media_cost numeric(12, 2) NOT NULL DEFAULT 0,
    starts_at timestamptz,
    ends_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_affiliate_idx ON public.campaigns (affiliate_id);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON public.campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_referral_code_idx ON public.campaigns (referral_code);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_referral_code_unique_idx
    ON public.campaigns (lower(referral_code));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_affiliate_id_fkey'
            AND conrelid = 'public.campaigns'::regclass
    ) THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT campaigns_affiliate_id_fkey
            FOREIGN KEY (affiliate_id) REFERENCES public.affiliates(id)
            ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_referral_code_safe_chk'
            AND conrelid = 'public.campaigns'::regclass
    ) THEN
        ALTER TABLE public.campaigns
            ADD CONSTRAINT campaigns_referral_code_safe_chk
            CHECK (referral_code ~ '^[A-Z0-9_-]{3,40}$');
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.acquisition_clicks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL,
    visitor_id text NOT NULL,
    landing_path text,
    referrer_url text,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_content text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acquisition_clicks_campaign_created_idx
    ON public.acquisition_clicks (campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS acquisition_clicks_visitor_idx
    ON public.acquisition_clicks (visitor_id);
CREATE INDEX IF NOT EXISTS acquisition_clicks_created_at_idx
    ON public.acquisition_clicks (created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'acquisition_clicks_campaign_id_fkey'
            AND conrelid = 'public.acquisition_clicks'::regclass
    ) THEN
        ALTER TABLE public.acquisition_clicks
            ADD CONSTRAINT acquisition_clicks_campaign_id_fkey
            FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS acquisition_campaign_id uuid,
    ADD COLUMN IF NOT EXISTS acquisition_click_id uuid,
    ADD COLUMN IF NOT EXISTS referral_code text,
    ADD COLUMN IF NOT EXISTS attributed_at timestamptz;

CREATE INDEX IF NOT EXISTS users_acquisition_campaign_idx
    ON public.users (acquisition_campaign_id);
CREATE INDEX IF NOT EXISTS users_acquisition_click_idx
    ON public.users (acquisition_click_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_acquisition_campaign_id_fkey'
            AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_acquisition_campaign_id_fkey
            FOREIGN KEY (acquisition_campaign_id) REFERENCES public.campaigns(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_acquisition_click_id_fkey'
            AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE public.users
            ADD CONSTRAINT users_acquisition_click_id_fkey
            FOREIGN KEY (acquisition_click_id) REFERENCES public.acquisition_clicks(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS media_cost numeric(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS starts_at timestamptz,
    ADD COLUMN IF NOT EXISTS ends_at timestamptz,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payment_intents
    ADD COLUMN IF NOT EXISTS campaign_id uuid;

CREATE INDEX IF NOT EXISTS payment_intents_campaign_idx
    ON public.payment_intents (campaign_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_campaign_id_fkey'
            AND conrelid = 'public.payment_intents'::regclass
    ) THEN
        ALTER TABLE public.payment_intents
            ADD CONSTRAINT payment_intents_campaign_id_fkey
            FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acquisition_clicks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliates, public.campaigns, public.acquisition_clicks
    FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.affiliates, public.campaigns, public.acquisition_clicks
    TO service_role;

CREATE OR REPLACE FUNCTION public.create_affiliate_with_campaign(
    p_name text,
    p_referral_code text,
    p_campaign_name text DEFAULT 'Divulgação inicial',
    p_media_cost numeric DEFAULT 0,
    p_handle text DEFAULT NULL,
    p_contact text DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_status text DEFAULT 'active'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_affiliate public.affiliates%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
BEGIN
    IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 2 AND 120
        OR p_campaign_name IS NULL OR length(btrim(p_campaign_name)) NOT BETWEEN 2 AND 160
        OR p_referral_code IS NULL OR p_referral_code !~ '^[A-Z0-9_-]{3,40}$'
        OR p_media_cost IS NULL OR p_media_cost::text IN ('NaN', 'Infinity', '-Infinity')
        OR p_media_cost < 0 OR p_media_cost > 9999999999.99
        OR p_status IS NULL OR p_status NOT IN ('active', 'paused', 'archived')
        OR length(p_handle) > 80 OR length(p_contact) > 180 OR length(p_notes) > 1000
    THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid affiliate campaign fields';
    END IF;

    INSERT INTO public.affiliates (name, handle, contact, notes, status)
    VALUES (btrim(p_name), nullif(btrim(p_handle), ''), nullif(btrim(p_contact), ''), nullif(btrim(p_notes), ''), p_status)
    RETURNING * INTO v_affiliate;

    -- The unique referral-code index also protects concurrent requests.
    -- Any campaign failure rolls back the affiliate inserted above.
    INSERT INTO public.campaigns (affiliate_id, name, referral_code, status, media_cost)
    VALUES (v_affiliate.id, btrim(p_campaign_name), p_referral_code, p_status, round(p_media_cost, 2))
    RETURNING * INTO v_campaign;

    RETURN jsonb_build_object('affiliate', to_jsonb(v_affiliate), 'campaign', to_jsonb(v_campaign));
END;
$$;

REVOKE ALL ON FUNCTION public.create_affiliate_with_campaign(text, text, text, numeric, text, text, text, text)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_affiliate_with_campaign(text, text, text, numeric, text, text, text, text)
    TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
