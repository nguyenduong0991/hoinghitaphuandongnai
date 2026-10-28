CREATE TABLE IF NOT EXISTS conference_need_surveys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    conference_id UUID REFERENCES conferences(id) ON DELETE SET NULL,
    survey_stage TEXT NOT NULL DEFAULT 'NEED' CHECK (survey_stage IN ('NEED', 'AFTER_EVENT')),
    legal_aid_need TEXT NOT NULL DEFAULT '',
    conference_need BOOLEAN NOT NULL DEFAULT FALSE,
    training_need TEXT NOT NULL DEFAULT '',
    suggested_area TEXT NOT NULL DEFAULT '',
    target_audience TEXT NOT NULL DEFAULT '',
    expected_participants INTEGER CHECK (expected_participants IS NULL OR expected_participants BETWEEN 0 AND 100000),
    topics TEXT NOT NULL DEFAULT '',
    questions TEXT NOT NULL DEFAULT '',
    quality_rating SMALLINT CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
    coordination_rating SMALLINT CHECK (coordination_rating IS NULL OR coordination_rating BETWEEN 1 AND 5),
    coordination_agencies TEXT NOT NULL DEFAULT '',
    comments TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conference_need_surveys_org_created ON conference_need_surveys(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conference_need_surveys_stage_area ON conference_need_surveys(survey_stage, suggested_area);
CREATE INDEX IF NOT EXISTS idx_conference_need_surveys_conference ON conference_need_surveys(conference_id);
