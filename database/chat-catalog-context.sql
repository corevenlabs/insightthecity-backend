-- Per-user conversational filters and shown catalog IDs; no customer data changes.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS catalog_context JSONB;
