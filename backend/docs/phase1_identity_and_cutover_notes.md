# Phase 1 Identity and Portal Auth Compatibility (Locked)

## Current portal auth semantics (must remain compatible)

The current portal status flow depends on these fields and semantics:

1. `magic_token` (token from URL)
2. `person_key`
3. `application_last_name` (normalized compare)
4. `application_phone` (10-digit normalized compare)

Phase 1 requires these fields to remain materialized in the compatibility model (`Candidates_shadow`) exactly enough to perform parity against `Candidates`.

## Ownership by phase

1. **Phase 1**: compatibility model (`Candidates_shadow`) remains authoritative for portal-auth compatibility checks.
2. **Later phase**: normalized `people` becomes source of truth for identity, token, and auth factors.

During phase 1, `people` may store identity fields, but these values are not cutover-authoritative for portal auth.

## Portal cutover blocker (explicit)

Phase 1 shadow parity on archive/interview fields is **not sufficient** for portal cutover.

Portal cutover is blocked until all token/identity compatibility fields are fully materialized and parity-validated:

1. `magic_token`
2. `person_key`
3. `application_last_name`
4. `application_phone`
5. `application_last_name_norm`

No portal read-path switch can occur before identity/token parity is proven.
