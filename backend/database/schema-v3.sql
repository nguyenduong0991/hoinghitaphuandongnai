BEGIN;

CREATE TABLE IF NOT EXISTS conference_task_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    assignee_name VARCHAR(200) NOT NULL,
    assignee_organization VARCHAR(255),
    due_at TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'ASSIGNED'
        CHECK (status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conference_tasks_conference
    ON conference_task_assignments(conference_id, status, due_at);

CREATE TABLE IF NOT EXISTS conference_speakers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    organization VARCHAR(255),
    role_title VARCHAR(160),
    presentation_title VARCHAR(255) NOT NULL,
    speaking_order INTEGER NOT NULL DEFAULT 1 CHECK (speaking_order > 0),
    duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 1 AND 600),
    notes TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conference_speakers_order
    ON conference_speakers(conference_id, speaking_order, created_at);

INSERT INTO schema_migrations(version)
VALUES ('v3-conference-assignments-speakers') ON CONFLICT DO NOTHING;

COMMIT;
