CREATE TABLE IF NOT EXISTS conference_task_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_assignment_id UUID NOT NULL REFERENCES conference_task_assignments(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_assignment
    ON conference_task_attachments(task_assignment_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations(version) VALUES ('v7-task-attachments') ON CONFLICT DO NOTHING;
