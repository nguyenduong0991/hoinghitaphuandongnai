CREATE TABLE IF NOT EXISTS conference_registration_organizations (
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conference_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_conference_registration_organizations_org
    ON conference_registration_organizations(organization_id, conference_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v24-private-reg-access') ON CONFLICT DO NOTHING;

