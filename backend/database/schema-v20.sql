CREATE TABLE IF NOT EXISTS legal_aid_contact_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_request_id UUID NOT NULL REFERENCES legal_aid_contact_requests(id) ON DELETE CASCADE,
    author_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 5 AND 4000),
    training_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (training_status IN ('PENDING','APPROVED','REJECTED')),
    training_text TEXT NOT NULL DEFAULT '',
    admin_note TEXT NOT NULL DEFAULT '',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_legal_aid_feedback_request_created
    ON legal_aid_contact_feedback(contact_request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_aid_feedback_training
    ON legal_aid_contact_feedback(training_status, reviewed_at DESC);

INSERT INTO schema_migrations(version) VALUES ('v20-legal-aid-consultation-feedback') ON CONFLICT DO NOTHING;
