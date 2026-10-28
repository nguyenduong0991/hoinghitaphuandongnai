BEGIN;

ALTER TABLE conference_task_assignments
    ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE conference_speakers
    ADD COLUMN IF NOT EXISTS speaker_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conference_tasks_assignee
    ON conference_task_assignments(assignee_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_conference_speakers_user
    ON conference_speakers(speaker_user_id, conference_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v5-assignment-accounts') ON CONFLICT DO NOTHING;

COMMIT;
