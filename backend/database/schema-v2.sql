BEGIN;

ALTER TABLE conferences ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE conferences ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'COMMUNE';
UPDATE users SET role = 'ADMIN' WHERE username = 'admin' AND role = 'COMMUNE';

CREATE TABLE IF NOT EXISTS venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_venues_active ON venues(is_active, name);

CREATE TABLE IF NOT EXISTS conference_participant_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    group_name VARCHAR(160) NOT NULL,
    participant_type VARCHAR(100) NOT NULL DEFAULT 'GENERAL',
    organization_name VARCHAR(255),
    expected_count INTEGER NOT NULL DEFAULT 0 CHECK (expected_count >= 0),
    actual_count INTEGER NOT NULL DEFAULT 0 CHECK (actual_count >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_participant_groups_conference ON conference_participant_groups(conference_id);

CREATE TABLE IF NOT EXISTS legal_aid_access_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    topic VARCHAR(160) NOT NULL DEFAULT 'ALL',
    population_group VARCHAR(160) NOT NULL DEFAULT 'ALL',
    contacts_count INTEGER NOT NULL DEFAULT 0 CHECK (contacts_count >= 0),
    referrals_count INTEGER NOT NULL DEFAULT 0 CHECK (referrals_count >= 0),
    cases_count INTEGER NOT NULL DEFAULT 0 CHECK (cases_count >= 0),
    source VARCHAR(160),
    notes TEXT,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_access_metric_period CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS idx_access_metrics_org_period ON legal_aid_access_metrics(organization_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_access_metrics_period ON legal_aid_access_metrics(period_start, period_end);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v2-demand-analysis') ON CONFLICT DO NOTHING;

COMMIT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_metrics_dimensions
    ON legal_aid_access_metrics(organization_id, period_start, period_end, topic, population_group);

CREATE TABLE IF NOT EXISTS conference_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    previous_status VARCHAR(30),
    new_status VARCHAR(30) NOT NULL,
    reason TEXT,
    changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_status_history_conference
    ON conference_status_history(conference_id, changed_at DESC);
