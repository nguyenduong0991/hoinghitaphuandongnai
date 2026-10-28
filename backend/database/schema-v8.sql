BEGIN;

ALTER TABLE conferences
    ADD COLUMN IF NOT EXISTS reschedule_response VARCHAR(16),
    ADD COLUMN IF NOT EXISTS reschedule_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reschedule_responded_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE conferences DROP CONSTRAINT IF EXISTS chk_conferences_reschedule_response;
ALTER TABLE conferences ADD CONSTRAINT chk_conferences_reschedule_response
    CHECK (reschedule_response IS NULL OR reschedule_response IN ('PENDING','ACCEPTED','DECLINED'));

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v8-registrant-reschedule-response') ON CONFLICT DO NOTHING;

COMMIT;
