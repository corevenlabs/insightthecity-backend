BEGIN;
CREATE TABLE IF NOT EXISTS partner_campaigns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','paused','archived')),
 draft_config JSONB NOT NULL, draft_version INTEGER NOT NULL DEFAULT 1, active_revision_id UUID,
 created_by INTEGER NOT NULL REFERENCES admins(id), updated_by INTEGER NOT NULL REFERENCES admins(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_campaign_revisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL REFERENCES partner_campaigns(id), version INTEGER NOT NULL,
 config JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'preparing' CHECK(state IN ('preparing','ready')),
 product_id TEXT, price_id TEXT, coupon_id TEXT, renewal_price_id TEXT, livemode BOOLEAN,
 created_by INTEGER NOT NULL REFERENCES admins(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(campaign_id,version)
);
ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS campaign_revision_id UUID REFERENCES partner_campaign_revisions(id);
ALTER TABLE partner_clients ADD COLUMN IF NOT EXISTS campaign_snapshot JSONB NOT NULL DEFAULT '{}';
DO $$ DECLARE item RECORD; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='partner_clients'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%offer%' LOOP
  EXECUTE format('ALTER TABLE partner_clients DROP CONSTRAINT %I',item.conname);
 END LOOP;
END $$;
ALTER TABLE partner_clients ADD CONSTRAINT partner_clients_offer_check CHECK(offer IN ('regular','founding','strategic','campaign'));
ALTER TABLE partner_clients ADD CONSTRAINT partner_clients_offer_configuration_check CHECK(
 (campaign_revision_id IS NULL AND ((category='strategic' AND offer='strategic' AND amount_cents=0 AND payment_method='waived') OR
 (category='partner' AND ((offer='founding' AND amount_cents=30000) OR (offer='regular' AND amount_cents=120000)) AND payment_method IN ('stripe','external')))) OR
 (offer='campaign' AND category='partner' AND campaign_revision_id IS NOT NULL AND payment_method='stripe' AND amount_cents>0));
CREATE TABLE IF NOT EXISTS partner_campaign_billing (
 client_id UUID PRIMARY KEY REFERENCES partner_clients(id), customer_id TEXT, payment_method_id TEXT, checkout_session_id TEXT UNIQUE,
 initial_subscription_id TEXT UNIQUE, initial_schedule_id TEXT UNIQUE, initial_invoice_id TEXT UNIQUE,
 renewal_subscription_id TEXT UNIQUE, renewal_schedule_id TEXT UNIQUE,
 first_paid_at TIMESTAMPTZ, billing_end TIMESTAMPTZ, publication_start TIMESTAMPTZ, publication_end TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','past_due','ended')),
 suspended_at TIMESTAMPTZ, restore_id TEXT, restore_version TIMESTAMPTZ, cancel_requested_at TIMESTAMPTZ,
 checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_campaign_invoices (
 invoice_id TEXT PRIMARY KEY, client_id UUID NOT NULL REFERENCES partner_clients(id), phase TEXT NOT NULL CHECK(phase IN ('initial','renewal')),
 status TEXT NOT NULL, amount_due INTEGER NOT NULL, amount_paid INTEGER NOT NULL, currency TEXT NOT NULL,
 period_start TIMESTAMPTZ, period_end TIMESTAMPTZ, hosted_url TEXT, pdf_url TEXT, paid_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS partner_campaign_events(event_id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE OR REPLACE FUNCTION freeze_ready_campaign_revision() RETURNS trigger AS $$ BEGIN
 IF OLD.state='ready' AND (NEW.state IS DISTINCT FROM OLD.state OR NEW.livemode IS DISTINCT FROM OLD.livemode OR NEW.config IS DISTINCT FROM OLD.config OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.price_id IS DISTINCT FROM OLD.price_id OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id OR NEW.renewal_price_id IS DISTINCT FROM OLD.renewal_price_id)
 THEN RAISE EXCEPTION 'Published campaign revision is immutable'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_freeze_ready_campaign_revision ON partner_campaign_revisions;
CREATE TRIGGER trg_freeze_ready_campaign_revision BEFORE UPDATE ON partner_campaign_revisions FOR EACH ROW EXECUTE FUNCTION freeze_ready_campaign_revision();
CREATE OR REPLACE FUNCTION freeze_partner_campaign_agreement() RETURNS trigger AS $$ BEGIN
 IF OLD.campaign_revision_id IS NOT NULL AND (NEW.campaign_revision_id IS DISTINCT FROM OLD.campaign_revision_id OR NEW.campaign_snapshot IS DISTINCT FROM OLD.campaign_snapshot OR NEW.amount_cents<>OLD.amount_cents OR NEW.offer<>OLD.offer OR NEW.payment_method<>OLD.payment_method OR NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot)
 THEN RAISE EXCEPTION 'Campaign agreement is immutable'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_freeze_partner_campaign_agreement ON partner_clients;
CREATE TRIGGER trg_freeze_partner_campaign_agreement BEFORE UPDATE ON partner_clients FOR EACH ROW EXECUTE FUNCTION freeze_partner_campaign_agreement();
CREATE OR REPLACE FUNCTION guard_partner_campaign_publication() RETURNS trigger AS $$ BEGIN
 IF NEW.is_published AND EXISTS(SELECT 1 FROM partner_clients p LEFT JOIN partner_campaign_billing b ON b.client_id=p.id WHERE p.experience_id=NEW.id AND p.offer='campaign' AND (b.first_paid_at IS NULL OR b.suspended_at IS NOT NULL OR b.status IN ('past_due','ended') OR p.blocked_at IS NOT NULL OR p.deleted_at IS NOT NULL))
 THEN RAISE EXCEPTION 'Publication suspended by campaign billing'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_partner_campaign_publication ON experiences;
CREATE TRIGGER trg_guard_partner_campaign_publication BEFORE INSERT OR UPDATE OF is_published ON experiences FOR EACH ROW EXECUTE FUNCTION guard_partner_campaign_publication();
COMMIT;
