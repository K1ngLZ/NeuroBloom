CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS guardians (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 consent_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS children (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL, birth_year SMALLINT, kid_pin_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 device_key_hash TEXT NOT NULL, label TEXT DEFAULT 'NeuroBand', last_seen TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS vitals (
 id BIGSERIAL PRIMARY KEY, child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 bpm SMALLINT NOT NULL CHECK (bpm BETWEEN 25 AND 250), signal_quality SMALLINT CHECK (signal_quality BETWEEN 0 AND 100),
 measured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vitals_child_time_idx ON vitals(child_id, measured_at DESC);
CREATE TABLE IF NOT EXISTS subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
 provider TEXT NOT NULL DEFAULT 'pagbank', provider_reference TEXT, status TEXT NOT NULL DEFAULT 'pending',
 amount_cents INTEGER NOT NULL DEFAULT 3999, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ
);
