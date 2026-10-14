BEGIN;
ALTER TABLE legal_acceptances ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE legal_acceptances DROP CONSTRAINT IF EXISTS legal_acceptances_user_id_fkey;
ALTER TABLE legal_acceptances ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS user_reference TEXT;
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS document_snapshot JSONB;
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS renewal_snapshot JSONB;
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS customer_reference TEXT;
ALTER TABLE legal_acceptances ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;
UPDATE legal_acceptances SET user_reference='ITC-U-'||user_id WHERE user_reference IS NULL AND user_id IS NOT NULL;
UPDATE legal_acceptances a SET document_snapshot=jsonb_build_object('id',d.id,'slug',d.slug,'version',d.version,'language',d.language,'title',d.title,'content',d.content)
FROM legal_documents d WHERE a.document_id=d.id AND a.version=d.version AND d.published_at IS NOT NULL AND a.document_snapshot IS NULL;
CREATE OR REPLACE FUNCTION preserve_legal_evidence_on_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 UPDATE legal_acceptances SET account_deleted_at=NOW() WHERE user_id=OLD.id;
 RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS preserve_legal_evidence ON users;
CREATE TRIGGER preserve_legal_evidence BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION preserve_legal_evidence_on_delete();
COMMIT;
