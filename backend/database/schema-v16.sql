CREATE TABLE IF NOT EXISTS legal_aid_contact_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    user_role TEXT NOT NULL,
    organization_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACKNOWLEDGED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_aid_contact_requests_status_created
    ON legal_aid_contact_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_aid_contact_requests_user_created
    ON legal_aid_contact_requests(user_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('v16-legal-aid-contact-requests') ON CONFLICT DO NOTHING;
