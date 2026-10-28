ALTER TABLE public_attendance_registrations
    ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS attended_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_public_attendance_checkin
    ON public_attendance_registrations(conference_id, attended_at);

INSERT INTO schema_migrations(version) VALUES ('v15-public-attendance-checkin') ON CONFLICT DO NOTHING;
