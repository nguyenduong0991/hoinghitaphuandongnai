CREATE TABLE IF NOT EXISTS conference_attendance_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    registered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expected_count INTEGER NOT NULL CHECK (expected_count BETWEEN 1 AND 100000),
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_registration_conference_org UNIQUE (conference_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_registrations_conference
    ON conference_attendance_registrations(conference_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attendance_registrations_org
    ON conference_attendance_registrations(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v12-cross-unit-attendance-registration') ON CONFLICT DO NOTHING;
