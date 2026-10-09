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
CREATE TABLE IF NOT EXISTS ble_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 client_connection_id UUID NOT NULL, device_hash CHAR(64) NOT NULL,
 device_name TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_packet_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
 UNIQUE(child_id,client_connection_id)
);
CREATE INDEX IF NOT EXISTS ble_sessions_child_time_idx ON ble_sessions(child_id,started_at DESC);
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy' CHECK(source IN ('legacy','ble','device'));
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS ble_session_id UUID REFERENCES ble_sessions(id) ON DELETE SET NULL;
ALTER TABLE vitals ADD COLUMN IF NOT EXISTS client_reading_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS vitals_reading_dedupe_idx ON vitals(child_id,client_reading_id);
CREATE TABLE IF NOT EXISTS subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), guardian_id UUID NOT NULL REFERENCES guardians(id) ON DELETE CASCADE,
 provider TEXT NOT NULL DEFAULT 'pagbank', provider_reference TEXT, status TEXT NOT NULL DEFAULT 'pending',
 amount_cents INTEGER NOT NULL DEFAULT 3999, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS alert_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), acknowledged_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS game_progress (
 child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL CHECK (game_id IN ('platform','speed','ninja','sword','energy')),
 progress JSONB NOT NULL CHECK (jsonb_typeof(progress) = 'object'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (child_id, game_id)
);
ALTER TABLE children ADD COLUMN IF NOT EXISTS game_nickname TEXT;
CREATE TABLE IF NOT EXISTS game_sessions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 child_id UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
 game_id TEXT NOT NULL CHECK (game_id IN ('platform','speed','ninja','sword','energy')),
 status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started','completed','ended')),
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(), ended_at TIMESTAMPTZ,
 duration_seconds INTEGER CHECK (duration_seconds BETWEEN 0 AND 86400),
 score INTEGER CHECK (score BETWEEN 0 AND 100000000),
 level INTEGER CHECK (level BETWEEN 0 AND 9999), stars SMALLINT CHECK (stars BETWEEN 0 AND 3)
);
CREATE INDEX IF NOT EXISTS game_sessions_child_time_idx ON game_sessions(child_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_one_active_idx ON game_sessions(child_id) WHERE status='started';
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS nickname TEXT;
