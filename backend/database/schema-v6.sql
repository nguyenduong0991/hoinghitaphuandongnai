BEGIN;

CREATE TABLE IF NOT EXISTS conference_staff_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type VARCHAR(16) NOT NULL CHECK (request_type IN ('TASK','SPEAKER')),
    task_assignment_id UUID REFERENCES conference_task_assignments(id) ON DELETE CASCADE,
    speaker_assignment_id UUID REFERENCES conference_speakers(id) ON DELETE CASCADE,
    requester_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    admin_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (request_type='TASK' AND task_assignment_id IS NOT NULL AND speaker_assignment_id IS NULL)
        OR
        (request_type='SPEAKER' AND speaker_assignment_id IS NOT NULL AND task_assignment_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_change_request_pending_task
    ON conference_staff_change_requests(task_assignment_id)
    WHERE request_type='TASK' AND status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_change_request_pending_speaker
    ON conference_staff_change_requests(speaker_assignment_id)
    WHERE request_type='SPEAKER' AND status='PENDING';
CREATE INDEX IF NOT EXISTS idx_staff_change_request_status_created
    ON conference_staff_change_requests(status,created_at DESC);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(40) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(version) VALUES ('v6-staff-change-requests') ON CONFLICT DO NOTHING;

COMMIT;