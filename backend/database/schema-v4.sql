BEGIN;

ALTER TABLE conferences
    ADD COLUMN IF NOT EXISTS proposed_start_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS proposed_end_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reschedule_note TEXT;

ALTER TABLE conferences DROP CONSTRAINT IF EXISTS chk_conferences_status;
ALTER TABLE conferences ADD CONSTRAINT chk_conferences_status
    CHECK (status IN ('PENDING','APPROVED','COMPLETED','REJECTED','CANCELLED','RESCHEDULED'));

ALTER TABLE conferences DROP CONSTRAINT IF EXISTS chk_conferences_proposed_time;
ALTER TABLE conferences ADD CONSTRAINT chk_conferences_proposed_time
    CHECK (proposed_end_time IS NULL OR proposed_start_time IS NULL OR proposed_end_time >= proposed_start_time);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v4-reschedule-status') ON CONFLICT DO NOTHING;

COMMIT;
