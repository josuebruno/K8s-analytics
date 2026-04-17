CREATE TABLE IF NOT EXISTS git_credentials (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    auth_type VARCHAR(20) NOT NULL CHECK (auth_type IN ('ssh_key', 'token')),
    git_username VARCHAR(255),
    secret_name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_git_credentials_user_id ON git_credentials(user_id);

ALTER TABLE code_sources
ADD COLUMN IF NOT EXISTS git_credential_id INTEGER REFERENCES git_credentials(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS entry_file VARCHAR(500);

ALTER TABLE data_sources
ADD COLUMN IF NOT EXISTS connection_json JSONB,
ADD COLUMN IF NOT EXISTS icon VARCHAR(50),
ADD COLUMN IF NOT EXISTS instructions TEXT;

ALTER TABLE job_runs
ADD COLUMN IF NOT EXISTS run_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS job_base_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS output_subdir_base VARCHAR(255),
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rerun_from_id INTEGER REFERENCES job_runs(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS node_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS runtime_details JSONB,
ADD COLUMN IF NOT EXISTS code_entry_file VARCHAR(500);

CREATE INDEX IF NOT EXISTS idx_job_runs_deleted_at ON job_runs(deleted_at);
CREATE INDEX IF NOT EXISTS idx_job_runs_rerun_from_id ON job_runs(rerun_from_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_run_name ON job_runs(run_name);
