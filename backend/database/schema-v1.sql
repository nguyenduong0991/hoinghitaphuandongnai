-- =========================================================
-- TGPL SYSTEM - DATABASE V1
-- Core schema
-- Database: tgpl
-- PostgreSQL
-- =========================================================

BEGIN;

-- =========================================================
-- 1. EXTENSION
-- =========================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =========================================================
-- 2. ORGANIZATIONS
-- Cơ quan / đơn vị / xã / phường
-- =========================================================

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,

    organization_type VARCHAR(50) NOT NULL,

    parent_id UUID NULL,

    address TEXT NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(255) NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_organizations_code
        UNIQUE (code),

    CONSTRAINT fk_organizations_parent
        FOREIGN KEY (parent_id)
        REFERENCES organizations(id)
        ON DELETE SET NULL
);


-- =========================================================
-- 3. USERS
-- Người sử dụng hệ thống
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    username VARCHAR(100) NOT NULL,
    password_hash TEXT NULL,

    full_name VARCHAR(255) NOT NULL,

    email VARCHAR(255) NULL,
    phone VARCHAR(30) NULL,

    organization_id UUID NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    last_login_at TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_username
        UNIQUE (username),

    CONSTRAINT fk_users_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE SET NULL
);


-- =========================================================
-- 4. CONFERENCES
-- Hội nghị / hoạt động đăng ký
-- =========================================================

CREATE TABLE IF NOT EXISTS conferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code VARCHAR(50) NOT NULL,

    title VARCHAR(500) NOT NULL,

    description TEXT NULL,

    organization_id UUID NOT NULL,

    created_by UUID NOT NULL,

    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NULL,

    location_name VARCHAR(255) NULL,
    location_address TEXT NULL,

    expected_participants INTEGER NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    notes TEXT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_conferences_code
        UNIQUE (code),

    CONSTRAINT fk_conferences_organization
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_conferences_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_conferences_participants
        CHECK (expected_participants >= 0),

    CONSTRAINT chk_conferences_status
        CHECK (
            status IN (
                'PENDING',
                'APPROVED',
                'COMPLETED',
                'REJECTED',
                'CANCELLED'
            )
        ),

    CONSTRAINT chk_conferences_time
        CHECK (
            end_time IS NULL
            OR end_time >= start_time
        )
);

CREATE TABLE IF NOT EXISTS conference_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conference_id UUID NOT NULL REFERENCES conferences(id) ON DELETE CASCADE,
    file_name VARCHAR(500) NOT NULL,
    storage_key VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(255) NULL,
    attachment_type VARCHAR(100) NULL,
    uploaded_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conference_attachments_conference
    ON conference_attachments(conference_id, uploaded_at DESC)
    WHERE is_deleted = FALSE;


-- =========================================================
-- 5. INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_organizations_parent_id
    ON organizations(parent_id);

CREATE INDEX IF NOT EXISTS idx_organizations_type
    ON organizations(organization_type);

CREATE INDEX IF NOT EXISTS idx_organizations_active
    ON organizations(is_active);


CREATE INDEX IF NOT EXISTS idx_users_organization_id
    ON users(organization_id);

CREATE INDEX IF NOT EXISTS idx_users_active
    ON users(is_active);


CREATE INDEX IF NOT EXISTS idx_conferences_organization_id
    ON conferences(organization_id);

CREATE INDEX IF NOT EXISTS idx_conferences_created_by
    ON conferences(created_by);

CREATE INDEX IF NOT EXISTS idx_conferences_start_time
    ON conferences(start_time);

CREATE INDEX IF NOT EXISTS idx_conferences_status
    ON conferences(status);

CREATE INDEX IF NOT EXISTS idx_conferences_organization_status
    ON conferences(organization_id, status);


-- =========================================================
-- 6. SAMPLE ORGANIZATIONS
-- =========================================================

INSERT INTO organizations
    (code, name, organization_type)
VALUES
    (
        'STP_DN',
        'Sở Tư pháp',
        'DEPARTMENT'
    ),
    (
        'TTTGPL_DN',
        'Trung tâm Trợ giúp pháp lý Nhà nước thành phố Đồng Nai',
        'LEGAL_AID_CENTER'
    ),
    (
        'XP_MAU',
        'Xã/Phường mẫu',
        'COMMUNE'
    )
ON CONFLICT (code) DO NOTHING;


-- =========================================================
-- 7. SAMPLE USER
-- =========================================================

INSERT INTO users
    (
        username,
        full_name,
        organization_id
    )
SELECT
    'admin',
    'Quản trị hệ thống',
    id
FROM organizations
WHERE code = 'TTTGPL_DN'
ON CONFLICT (username) DO NOTHING;


-- =========================================================
-- 8. SAMPLE CONFERENCE
-- =========================================================

INSERT INTO conferences
    (
        code,
        title,
        description,
        organization_id,
        created_by,
        start_time,
        end_time,
        location_name,
        location_address,
        expected_participants,
        status
    )
SELECT
    'HN-0001',
    'Hội nghị tuyên truyền trợ giúp pháp lý',
    'Dữ liệu mẫu phục vụ kiểm thử hệ thống',
    o.id,
    u.id,
    '2026-10-15 08:00:00+07',
    '2026-10-15 11:00:00+07',
    'Hội trường UBND xã/phường mẫu',
    'Đồng Nai',
    100,
    'PENDING'
FROM organizations o
JOIN users u
    ON u.username = 'admin'
WHERE o.code = 'XP_MAU'
ON CONFLICT (code) DO NOTHING;


COMMIT;
