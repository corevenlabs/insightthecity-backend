# Publication: unsupported pasted characters

Observed production symptom: 22 partner-experience save requests returned HTTP 500
on 2026-11-15. Matching server messages were PostgreSQL SQLSTATE 22021. Logs did
not retain request contents or identify the exact field. A local real PostgreSQL
`SELECT $1::text` with U+0000 reproduces that SQLSTATE.

This fix removes only U+0000 from known editorial text fields before validation
and persistence. It includes nested tags, includes and branch names/addresses.
Accents, emoji sequences, newlines, zero-width joiners and other valid Unicode are
unchanged. URLs, identifiers, dates, flags and numbers are not silently rewritten;
a NUL in those fields produces a field-specific HTTP 400. Generic DB character
errors (22021 / 22P05) receive an actionable 400 without leaking SQL or user data.

Covered entry points: direct experience create/update, the partner-specific draft
save that calls those controllers, standalone draft JSON storage, and approval of
an edited standalone draft. Existing panel bundles benefit without an update.

Local integration used a newly created isolated `itc_publication_text_test_*`
database: reproduce the SQLSTATE, save a premium partner draft with pasted NULs,
check preserved text/images/date/external benefit URL, verify executive cannot
publish, publish as admin, verify commercial/payment row unchanged, save and
approve a standalone draft, reject damaged URLs without changing stored URLs.

No production publication, activation, payment, email, commercial terms, mobile
build or OTA is performed as part of verification. No schema migration is added.
