CREATE TABLE IF NOT EXISTS public_attendance_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    attendee_name VARCHAR(160) NOT NULL,
    attendee_address VARCHAR(500) NOT NULL,
    attendee_email VARCHAR(254),
    attendee_key CHAR(64) NOT NULL,
    conference_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_public_attendee_name CHECK (length(trim(attendee_name)) BETWEEN 1 AND 160),
    CONSTRAINT chk_public_attendee_address CHECK (length(trim(attendee_address)) BETWEEN 1 AND 500),
    CONSTRAINT uq_public_attendee_date UNIQUE (attendee_key, conference_date)
);

CREATE INDEX IF NOT EXISTS idx_public_attendance_conference
    ON public_attendance_registrations(conference_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('v14-public-attendance-registration') ON CONFLICT DO NOTHING;
