# Candidates_shadow Materializer Mapping (Phase 1)

Source priority legend:

1. `NORM` = normalized tables (`people`, `applications`, `interviews`)
2. `LEGACY` = existing `Candidates` row (lookup by `lever_id`) for compatibility carry-forward
3. `CONST` = fixed literal/null/default

| Candidates_shadow column | Source in phase 1 | Rule |
|---|---|---|
| id | DB identity | Insert default only |
| created_at | LEGACY then DB default | Carry forward if present, else `now()` |
| lever_id | NORM.applications.lever_opportunity_id | Required upsert key |
| name | NORM.applications.candidate_name else LEGACY.name | Null-safe fallback |
| email | LEGACY.email | Not part of slice; carry forward only |
| phone | LEGACY.phone | Not part of slice; carry forward only |
| last_four | LEGACY.last_four | Not part of slice; carry forward only |
| magic_token | LEGACY.magic_token | Portal auth compatibility field; must be preserved |
| current_stage | NORM.applications.current_stage | Direct map |
| position | NORM.applications.position else LEGACY.position | Null-safe fallback |
| application_phone | LEGACY.application_phone | Portal auth compatibility field; preserve in phase 1 |
| next_interview | NORM.applications.next_interview | Earliest future uncanceled interview |
| stage_updated | NORM.applications.stage_updated else now() | Direct map |
| person_key | NORM.applications.person_key | Portal auth compatibility field |
| portal_access | LEGACY.portal_access | Not part of slice; carry forward |
| identity_confidence | NORM.people.identity_confidence else LEGACY.identity_confidence | Null-safe fallback |
| portal_stage | NORM.applications.portal_stage | Shared rules output |
| portal_stage_order | NORM.applications.portal_stage_order | Shared rules output |
| offer_access | LEGACY.offer_access | Ignore in parity for this slice |
| portal_stage_terminal | NORM.applications.portal_stage_terminal | Shared rules output |
| application_last_name_norm | NORM.people.application_last_name_norm else LEGACY.application_last_name_norm | Portal auth compatibility field |
| archived | NORM.applications.archived | Archive webhook output |
| offer_letter_key | LEGACY.offer_letter_key | Not part of slice; carry forward |
| offer_letter_signed_url | LEGACY.offer_letter_signed_url | Not part of slice; carry forward |
| hiring_manager | LEGACY.hiring_manager | Not part of slice; carry forward |
| recruiter | LEGACY.recruiter | Not part of slice; carry forward |
| offer_status | LEGACY.offer_status | Not part of slice; carry forward |
| offer_file_path | LEGACY.offer_file_path | Not part of slice; carry forward |
| archive_reason | NORM.applications.archive_reason | Archive webhook output |
| recruiter_email | LEGACY.recruiter_email | Not part of slice; carry forward |
| offer_uploaded_at | LEGACY.offer_uploaded_at | Not part of slice; carry forward |
| application_last_name | LEGACY.application_last_name | Portal auth compatibility field; preserve in phase 1 |

## Deterministic carry-forward behavior

When a field is marked LEGACY-only, materializer reads current `Candidates` row by `lever_id` and copies the value unchanged into `Candidates_shadow`.

If no legacy row exists, the field is left null.
