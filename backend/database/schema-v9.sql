BEGIN;

ALTER TABLE conference_task_assignments
    ADD COLUMN IF NOT EXISTS evaluation_rating SMALLINT,
    ADD COLUMN IF NOT EXISTS evaluation_note TEXT,
    ADD COLUMN IF NOT EXISTS evaluated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS evaluated_at TIMESTAMPTZ;

ALTER TABLE conference_task_assignments DROP CONSTRAINT IF EXISTS chk_task_evaluation_rating;
ALTER TABLE conference_task_assignments ADD CONSTRAINT chk_task_evaluation_rating
    CHECK (evaluation_rating IS NULL OR evaluation_rating BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v9-task-outcome-evaluation') ON CONFLICT DO NOTHING;

COMMIT;
