ALTER TABLE legal_aid_contact_requests
    ADD COLUMN IF NOT EXISTS assigned_staff_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assignment_note TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS contact_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE legal_aid_contact_requests SET status='PENDING' WHERE status='ACKNOWLEDGED';
ALTER TABLE legal_aid_contact_requests DROP CONSTRAINT IF EXISTS legal_aid_contact_requests_status_check;
ALTER TABLE legal_aid_contact_requests ADD CONSTRAINT legal_aid_contact_requests_status_check
    CHECK (status IN ('PENDING', 'ASSIGNED', 'CONTACTED', 'CLOSED'));

CREATE INDEX IF NOT EXISTS idx_legal_aid_contact_requests_status_updated
    ON legal_aid_contact_requests(status, updated_at DESC);

INSERT INTO schema_migrations(version) VALUES ('v17-legal-aid-contact-assignment') ON CONFLICT DO NOTHING;
