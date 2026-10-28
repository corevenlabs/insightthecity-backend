CREATE TABLE IF NOT EXISTS content_translations (
 source_hash CHAR(64) NOT NULL,
 language VARCHAR(2) NOT NULL CHECK (language IN ('en','pt')),
 translated_text TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (source_hash,language)
);
