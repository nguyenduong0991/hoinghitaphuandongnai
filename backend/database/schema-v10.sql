CREATE TABLE IF NOT EXISTS ai_answer_feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,
    username TEXT NOT NULL DEFAULT '',
    user_role TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    vote TEXT NOT NULL CHECK (vote IN ('CORRECT', 'INCORRECT')),
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWED', 'RESOLVED')),
    admin_note TEXT NOT NULL DEFAULT '',
    correction_text TEXT NOT NULL DEFAULT '',
    correction_source_title TEXT NOT NULL DEFAULT '',
    correction_source_url TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_status_created ON ai_answer_feedback(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_answer_feedback_vote_created ON ai_answer_feedback(vote, created_at DESC);
ALTER TABLE ai_answer_feedback ADD COLUMN IF NOT EXISTS correction_text TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_answer_feedback ADD COLUMN IF NOT EXISTS correction_source_title TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_answer_feedback ADD COLUMN IF NOT EXISTS correction_source_url TEXT NOT NULL DEFAULT '';
