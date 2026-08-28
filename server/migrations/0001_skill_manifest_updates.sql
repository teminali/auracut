-- Apply once to a store created before manifest-only skill updates.
ALTER TABLE skills ADD COLUMN included INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skill_versions ADD COLUMN manifest_json TEXT;
