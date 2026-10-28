ALTER TABLE legal_aid_contact_requests
    ADD COLUMN IF NOT EXISTS assigned_staff_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_legal_aid_contact_requests_assigned_staff
    ON legal_aid_contact_requests(assigned_staff_user_id, status, updated_at DESC);

-- Link existing name-based assignments only when exactly one active staff account matches.
WITH matching_staff AS (
    SELECT r.id, MIN(u.id::text)::uuid AS staff_id, COUNT(*) AS match_count
    FROM legal_aid_contact_requests r
    JOIN users u ON u.is_active=TRUE AND u.role IN ('TASK_ASSIGNEE','SPEAKER')
      AND LOWER(BTRIM(u.full_name))=LOWER(BTRIM(r.assigned_staff_name))
    WHERE r.assigned_staff_name<>'' AND r.assigned_staff_user_id IS NULL
    GROUP BY r.id
)
UPDATE legal_aid_contact_requests r
SET assigned_staff_user_id=m.staff_id
FROM matching_staff m
WHERE r.id=m.id AND m.match_count=1;

INSERT INTO schema_migrations(version) VALUES ('v19-legal-aid-assignee-account') ON CONFLICT DO NOTHING;
