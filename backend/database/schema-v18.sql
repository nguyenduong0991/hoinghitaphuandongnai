ALTER TABLE ai_answer_feedback
    ADD COLUMN IF NOT EXISTS reason_code TEXT NOT NULL DEFAULT 'UNSPECIFIED';

ALTER TABLE ai_answer_feedback DROP CONSTRAINT IF EXISTS ai_answer_feedback_reason_code_check;
ALTER TABLE ai_answer_feedback ADD CONSTRAINT ai_answer_feedback_reason_code_check
    CHECK (reason_code IN ('WRONG_DATA','WRONG_SCOPE','IRRELEVANT','INCOMPLETE','TOO_LONG','MISSING_SOURCE','OTHER','UNSPECIFIED'));

INSERT INTO schema_migrations(version) VALUES ('v18-ai-feedback-reasons') ON CONFLICT DO NOTHING;