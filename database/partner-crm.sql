BEGIN;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS phone TEXT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='admins_role_check') THEN
 ALTER TABLE admins ADD CONSTRAINT admins_role_check CHECK(role IN ('admin','editor','executive'));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS staff_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id INTEGER NOT NULL REFERENCES admins(id),
 token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_terms (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), variant TEXT NOT NULL CHECK(variant IN ('regular','founding','strategic')),
 language TEXT NOT NULL CHECK(language IN ('en','es','pt')), version INTEGER NOT NULL CHECK(version>0), title TEXT NOT NULL,
 content TEXT NOT NULL, approved_at TIMESTAMPTZ, created_by INTEGER NOT NULL REFERENCES admins(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(variant,language,version)
);
CREATE TABLE IF NOT EXISTS partner_clients (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','es','pt')),
 owner_id INTEGER NOT NULL REFERENCES admins(id), category TEXT NOT NULL CHECK(category IN ('partner','strategic')),
 offer TEXT NOT NULL CHECK(offer IN ('regular','founding','strategic')), amount_cents INTEGER NOT NULL,
 payment_method TEXT NOT NULL CHECK(payment_method IN ('stripe','external','waived')),
 payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','waived')),
 payment_reference TEXT, payment_verified_by INTEGER REFERENCES admins(id), payment_verified_at TIMESTAMPTZ,
 stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT UNIQUE,
 form_status TEXT NOT NULL DEFAULT 'not_sent' CHECK(form_status IN ('not_sent','invited','draft','submitted','changes_requested','ready')),
 content JSONB NOT NULL DEFAULT '{}', terms_snapshot JSONB NOT NULL DEFAULT '{}',
 link_version UUID NOT NULL DEFAULT gen_random_uuid(), link_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '90 days',
 submitted_at TIMESTAMPTZ, submission_version INTEGER NOT NULL DEFAULT 0,
 experience_id VARCHAR(120) REFERENCES experiences(id) ON DELETE SET NULL,
 activated_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
 renewal_status TEXT NOT NULL DEFAULT 'pending' CHECK(renewal_status IN ('pending','contacted','negotiating','renewed')),
 next_followup DATE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((category='strategic' AND offer='strategic' AND amount_cents=0 AND payment_method='waived') OR
       (category='partner' AND ((offer='founding' AND amount_cents=30000) OR (offer='regular' AND amount_cents=120000)) AND payment_method IN ('stripe','external')))
);
CREATE INDEX IF NOT EXISTS partner_clients_owner_idx ON partner_clients(owner_id);
CREATE INDEX IF NOT EXISTS partner_clients_expiry_idx ON partner_clients(expires_at);
CREATE TABLE IF NOT EXISTS partner_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES partner_clients(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('logo','photo')), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL,
 bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS partner_files_client_idx ON partner_files(client_id);
CREATE TABLE IF NOT EXISTS partner_acceptances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES partner_clients(id),
 stage TEXT NOT NULL CHECK(stage IN ('commercial','submission')), language TEXT NOT NULL,
 signer_name TEXT NOT NULL, signer_email TEXT NOT NULL, document JSONB NOT NULL, material_authorized BOOLEAN NOT NULL DEFAULT FALSE,
 submission_version INTEGER NOT NULL DEFAULT 0, accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_activity (
 id BIGSERIAL PRIMARY KEY, client_id UUID NOT NULL REFERENCES partner_clients(id), actor_id INTEGER REFERENCES admins(id),
 kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_periods (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES partner_clients(id), starts_at TIMESTAMPTZ NOT NULL,
 ends_at TIMESTAMPTZ NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), reference TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES admins(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(ends_at>starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_periods_reference_idx ON partner_periods(client_id,reference);
CREATE TABLE IF NOT EXISTS partner_mail (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID REFERENCES partner_clients(id), dedupe_key TEXT NOT NULL UNIQUE,
 recipient TEXT NOT NULL, message JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','canceled')),
 attempts INTEGER NOT NULL DEFAULT 0, error_code TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ,
 locked_at TIMESTAMPTZ
);
ALTER TABLE partner_mail DROP CONSTRAINT IF EXISTS partner_mail_status_check;
ALTER TABLE partner_mail ADD CONSTRAINT partner_mail_status_check CHECK(status IN ('pending','sending','sent','failed','canceled'));
COMMIT;
