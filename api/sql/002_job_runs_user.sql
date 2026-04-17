ALTER TABLE job_runs
ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_job_runs_user_id ON job_runs(user_id);
