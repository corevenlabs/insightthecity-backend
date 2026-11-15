# External benefit availability without a mobile release

Only panel and backend changes. No mobile source, Expo settings, OTA, Android build,
iOS build or store submission is part of this change. QR scheduling, inventory,
redemption and membership checks are unchanged.

The editor exposes two optional dates only for premium external-link benefits.
They use separate external_benefit_starts_at / external_benefit_ends_at columns,
not the coupon_* columns. Existing rows default to NULL and their behavior remains
unchanged until an administrator configures the new dates. The publication itself
is not hidden or unpublished by these dates.

Public experience responses replace a dated external benefit URL with a backend
availability URL. If the same experience uses the app's paid-event CTA, its ticket
URL is also routed through the same availability check, preserving each original
destination. This covers the already-installed app's CTA priority without modifying
its JavaScript. Admin list and `?view=admin` detail responses retain the source URLs;
the latter requires the existing admin/editor authentication. Saving a managed URL
as a source is rejected to prevent redirect loops from older cached panel pages.

The browser gate reads the current published experience and window on every visit:
before start: localized Coming soon page; [start,end): HTTP 303 to the original HTTPS
URL, preserving its coupon/query; at/after end: localized Benefit ended page. Removed,
unpublished, non-premium and QR records return unavailable without redirecting.
No client-supplied destination or timestamp is trusted. Responses are not cached.
HTML is escaped, denies framing/scripts, and exposes no provider URL while blocked.
Pages support ES/EN/PT and display dates explicitly in America/New_York; editor
inputs state the administrator's device timezone and persist UTC instants.

Limits: the app's native button keeps its existing appearance. Enforcement happens
in the browser page. Old provider URLs copied before the change, already-open
provider checkout pages, offline cached app responses with the former direct URL,
and independently distributed provider links cannot be revoked by this gate. Any
provider-side expiration must also be configured at the provider when required.
After an ordinary app content refresh, configured experiences receive the gate URL.
Removing the dates lets existing gate URLs redirect normally again.

Verification: unit/browser HTTP tests cover boundaries, DST offsets, bad dates,
localized escaped pages, original coupon query preservation, ticket CTA priority,
no open redirect and unpublished/QR refusal. A fresh local PostgreSQL integration
checks create/update/admin/public views, partial-update rollback, standalone draft
approval and exact preservation of a QR fixture's full database row. No production
benefit dates are set automatically and no real customer checkout is completed.

Deployment order: backend migration and runtime first, then panel. Cleanup of retired
sample content remains the final normal migration. New schema change is additive.
Rollback: remove the dates to restore direct public URLs; retained gate URLs also
work without dates. Do not remove the gate route while published URLs may be cached.
