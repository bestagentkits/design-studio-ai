ALTER TABLE media_jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'video' CHECK(kind IN ('image','audio','video'));
