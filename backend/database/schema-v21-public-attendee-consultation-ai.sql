ALTER TABLE public_attendance_registrations
    ADD COLUMN IF NOT EXISTS consultation_situation TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public_attendee_ai_training (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question TEXT NOT NULL CHECK (char_length(question) BETWEEN 5 AND 1200),
    training_text TEXT NOT NULL CHECK (char_length(training_text) BETWEEN 20 AND 4000),
    source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
    period_start DATE,
    period_end DATE,
    training_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (training_status IN ('PENDING','APPROVED','REJECTED')),
    admin_note TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_attendee_ai_training_status
    ON public_attendee_ai_training(training_status, reviewed_at DESC, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('v21-public-attendee-consultation-ai') ON CONFLICT DO NOTHING;
