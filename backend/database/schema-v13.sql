ALTER TABLE conferences
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_conferences_public_upcoming
    ON conferences(start_time)
    WHERE is_public=TRUE AND status='APPROVED';

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v13-public-conferences') ON CONFLICT DO NOTHING;
