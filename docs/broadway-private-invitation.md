# Broadway: invitation using an existing external agreement

Scope: only client `8cf3ff36-2f17-4711-81cf-3b857cc40e16`, exact business name,
strategic zero-dollar offer and invitation version in the server config. Old versions
and every other client retain the standard online agreement requirement.

The operator reports a separately signed agreement. No signature, date or contents
of that external document are fabricated or imported. Confirmation by the named
visitor is recorded as `external-agreement-confirmed` activity, not an online
commercial acceptance. No accepted-terms PDF or accepted-terms email is produced.

Stripe checkout, fixed coupon validation, expected amount, email matching, session
ownership, signed reference, receipt and webhook verification remain mandatory.
No changes to Stripe products, prices, discounts or checkout creation code.
Form access and uploads remain locked until Stripe confirms. Material authorization
remains required and its submission record does not embed the standard contract.
Admin progress identifies the external agreement separately from an online acceptance.

Manual preparation workflow defaults to read-only. It checks the specific untouched
client and reads live Stripe pricing/coupon configuration. Apply changes only this
row's invitation version, expiry and updated timestamp and adds one activity entry.
No email is queued/sent. The new signed private link is a one-day private artifact,
never printed in logs. Repeat apply is idempotent while the client has not advanced.
It refuses to rotate if a checkout, online agreement, activation or form already exists.

Deployment order: panel and backend first, then guarded invitation preparation.
The prior invitation keeps working normally until the rotation. After rotation it
fails the existing token version check. The same client row and saved data remain.

Rollback: remove the exact exception config and redeploy backend; the new invitation
then uses the standard workflow. No mobile build/OTA, database schema migration,
commercial activation, publication or commercial-period change is part of this work.
