ALTER TABLE data_sources
ADD COLUMN IF NOT EXISTS secret_encrypted TEXT,
ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_test_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS last_test_message TEXT,
ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_data_sources_deleted_at ON data_sources(deleted_at);
CREATE INDEX IF NOT EXISTS idx_data_sources_enabled ON data_sources(is_enabled);

CREATE TABLE IF NOT EXISTS data_source_changes (
    id SERIAL PRIMARY KEY,
    data_source_id INTEGER NOT NULL,
    changed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    change_type VARCHAR(50) NOT NULL,
    before_json JSONB,
    after_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_source_changes_data_source_id ON data_source_changes(data_source_id);
