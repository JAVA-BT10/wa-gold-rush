# Checkpoint approval security audit and migration contract

## Scope and conclusion

Audited repository SHA: **`f7456c30d89eb8d0f1475e22b30ee09737da2ad7`** (follow-up baseline after PR #63, merged as `4327d801c56c9cb11018325c052d14353a35ec77` on October 15, 2026 at 06:42:30Z). All evidence links below are pinned to the audited SHA, not moving branch lines.

**Current mode: direct browser integration, not confidential.** The teacher's browser calls the approval flow. Actions reads `WA_GGR_SAVE_CHECKPOINT_APPROVAL_URL` during the build and publishes its value, together with `WA_GGR_API_KEY`, in Pages JavaScript. Secret storage keeps these build inputs out of tracked source; it does not hide the deployed values.

No backend or GitHub Actions invocation of the approval flow was found in repository code. No student-game approval caller was found. This is a repository-code audit only: deployed Power Automate definitions, trigger authentication settings, tenant policies, Lists permissions and live requests were not inspected. It does not establish whether live flows independently enforce authorization.

This follow-up changes documentation and test clarity, not runtime behavior. It neither implements a backend nor makes the signed URL confidential.

## Invocation inventory

Search covered the literal `GGR_SaveCheckpointApproval`, alias `saveCheckpointApproval`, `APPROVAL_FLOW_NAME`, exported `saveApproval`, review-modal/button wiring, generic transport/batch helpers and their callers, endpoint configuration, tests and documentation.

| Classification | SHA-pinned evidence | What executes / URL use |
| --- | --- | --- |
| Browser bootstrap (not invocation) | [teacher/dashboard.html:423–453](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard.html#L423-L453) | Loads runtime config, endpoint registry, transport and checkpoint modules; initializes checkpoint dashboard. |
| Browser review entry | [teacher/checkpoint-dashboard.js:147–175,183–193](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-dashboard.js#L147-L193) | Review button opens `CheckpointApproval.showReviewModal`; configuration supplies the dashboard reference. No network call yet. |
| Browser decision callers | [teacher/checkpoint-approval.js:284–304](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L284-L304) | Approve (`approved`, line 303) and retake (`retake_requested`, line 304) share `submitDecision`, which calls `saveApproval` at line 290. |
| **Approval-specific transport invocation** | [teacher/checkpoint-approval.js:83–118](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L83-L118) | Lines 105–106 build payload and call `target.postFlowPayload(APPROVAL_FLOW_NAME, payload)`. This is the only production approval-specific transport call found. |
| Browser alias/payload/helpers | [teacher/checkpoint-approval.js:15–76](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L15-L76), [exports:307–324](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L307-L324) | Alias is `saveCheckpointApproval` (line 16); helpers resolve dashboard, check configuration, read session reviewer and build payload. Exported `saveApproval` also permits programmatic use; no other production caller found. `rejected` is accepted programmatically, but has no modal button. |
| Browser dashboard transport | [teacher/dashboard-state.js:127–176](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-state.js#L127-L176) | Resolves alias to configured URL; blocks missing/placeholder endpoint or missing API key; calls `WA_GOLD_RUSH_POWER_AUTOMATE.callFlow` at lines 147–156 with the endpoint and API key. It consumes the injected URL indirectly, not an Actions environment variable. |
| Browser shared transport / **actual network sink** | [shared/power-automate-headers.js:125–161](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/power-automate-headers.js#L125-L161), [58–105](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/power-automate-headers.js#L58-L105), [20–32](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/power-automate-headers.js#L20-L32) | `callFlow` resolves endpoint and calls `postToFlow`. It selects custom/global fetch at lines 80–82; `fetchImpl` POSTs JSON at lines 93–105. Header builder attaches `X-GGR-Key` at line 29. In production this runs in the browser. |

Core call snippets (not separate invocations):

```js
const APPROVAL_FLOW_NAME = 'saveCheckpointApproval';
const payload = buildApprovalPayload({ student, level, status, reviewer });
const result = await target.postFlowPayload(APPROVAL_FLOW_NAME, payload);
```

The current flow body remains: `studentCode`, `classCode`, `level`, `progressKey`, `approvalStatus`, `approverName`, `approverEmail`, `approvalTimestamp`. The browser builds the canonical key and timestamp; these remain untrusted inputs. Do not rename reviewer fields without verifying the deployed schema.

## Configuration, tests and references — not production invocations

| Category | SHA-pinned evidence | Meaning |
| --- | --- | --- |
| Actions build configuration | [.github/workflows/build-and-deploy.yml:24–39](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/.github/workflows/build-and-deploy.yml#L24-L39), [73–94](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/.github/workflows/build-and-deploy.yml#L73-L94), [196–213](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/.github/workflows/build-and-deploy.yml#L196-L213) | Reads both Actions secrets, maps approval URL to `saveCheckpointApproval`, writes `pages-dist/teacher/runtime-config.js`, uploads/deploys Pages. **Does not call the approval flow.** |
| Endpoint registry | [shared/flow-endpoints.js:17–30](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/flow-endpoints.js#L17-L30) | Starts approval empty; applies valid runtime, existing-shared, then dashboard overrides, ignoring blanks/placeholders. |
| Dashboard endpoint/key configuration | [teacher/dashboard-config.js:9–55](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-config.js#L9-L55), [99–135](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-config.js#L99-L135) | Approval precedence: valid dashboard override → shared registry → runtime fallback → unavailable placeholder. Key comes from dashboard override or runtime global. |
| Tracked development stub | [teacher/runtime-config.js:1–8](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/runtime-config.js#L1-L8) | No approval URL/key; this says nothing about the generated deployed file. |
| Other browser config consumers | [index.html:417–430](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/index.html#L417-L430), [levels/level-2-tycoon/index.html:239–252](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/levels/level-2-tycoon/index.html#L239-L252) | Home/game also load generated config. Loading exposes values; it is not an approval call. |
| Simulated build/config tests | [tests/wiring-reliability.test.js:115–144](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/tests/wiring-reliability.test.js#L115-L144), [268–386](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/tests/wiring-reliability.test.js#L268-L386) | Synthetic runtime renderer, VM precedence tests and workflow source checks; not a live deployment or security guarantee. |
| Mocked approval tests | [tests/wiring-reliability.test.js:1013–1041](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/tests/wiring-reliability.test.js#L1013-L1041), [1762–1818](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/tests/wiring-reliability.test.js#L1762-L1818) | Fabricated teacher session and mocked `callFlow`; direct `saveApproval` calls test unavailable and successful mocked paths plus read-back. Source assertions excluding localStorage/prompt do not authenticate sessionStorage. |
| Documentation references | [README.md:80–98](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/README.md#L80-L98), [docs/power-automate/GGR_SaveProgress-repair-spec.md:91–133](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/docs/power-automate/GGR_SaveProgress-repair-spec.md#L91-L133) | Describe approval ownership, configuration, payload and required flow behavior; not executable callers or proof those requirements are deployed. |

The [tracked Word flow inventory](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/Current%20Flow%20Inventory.docx) was also checked (ZIP/XML text); no checkpoint approval reference was found.

Additional helper tracing found no extra approval caller:

- [dashboard-state.js:806–876](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-state.js#L806-L876): generic per-item/bulk helpers are used only for student/teacher imports, not approval.
- [sharepoint-sync.js:302–318](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/sharepoint-sync.js#L302-L318), [628–654](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/sharepoint-sync.js#L628-L654): generic transport/retry selects profile or progress saves, not approval.
- [power-automate-headers.js:201–219](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/shared/power-automate-headers.js#L201-L219): exports header/transport helpers through the browser global and CommonJS, not another invocation.
- The two direct test calls to `saveApproval` are at pinned test lines **1771–1776** (unconfigured) and **1798–1803** (mocked success); neither invokes a live flow.

## Why Actions secrets do not remain confidential here

There is no Actions `env` in a browser. The build reads environment variables and serializes their values into generated JavaScript. Anyone able to download the Pages asset can read the signed trigger URL and API key even without signing into the dashboard; network tools also show the URL and `X-GGR-Key`. Cache busting, an empty source stub, HTTPS, and Actions log masking do not make these values secret from the client.

Keep credentials out of tracked source, fixtures, screenshots and logs. Never paste a live signed URL into this document or tests. These are source/log hygiene controls, not runtime confidentiality. A browser-visible shared key is not individual teacher authentication. **CORS is not authentication** and does not stop non-browser callers.

[teacher/dashboard-state.js:891–967](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-state.js#L891-L967) reads/writes plain `sessionStorage` identity, role and classes. [Reviewer extraction:44–54](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L44-L54) copies these into the request. They are editable client claims, not cryptographically authenticated assertions. Looking up a submitted `approverEmail` alone does not prove that caller owns that identity.

## Required migration contract — not implemented

```text
Browser -- per-user authentication --> Authenticated API
Authenticated API -- server-held trigger URL + service key --> Approval flow
```

### Deployment prerequisites

- Choose backend hosting outside GitHub Pages, an owner and HTTPS public API endpoint. Pages hosts static assets and cannot itself run this confidential backend.
- Select and configure a real per-user authentication mechanism and trusted identity provider/session issuer. Provider, tenant, issuer/audience, account mapping, login/logout, expiry/revocation and hosting details are not supplied here; they are rollout blockers, not assumed existing infrastructure.
- Validate signed tokens (including signature, issuer, audience and expiry) or server-managed sessions. For cookie sessions require Secure/HttpOnly cookies, appropriate SameSite policy and CSRF protection; configure narrowly scoped CORS separately if cross-origin.
- Put the signed trigger URL and service API key in the backend's runtime secret store with least-privilege access. Browser receives only the public API endpoint and the selected per-user auth mechanism, never flow credentials.
- Inspect the live flow schema, trigger access controls, Lists mappings and success response. Restrict flow access to the backend using supported controls; decide how any shared key used by other flows will be separated before cutover. Do not silently change live triggers. OAuth-authenticated Power Automate triggers may be evaluated separately, with explicit tenant/client compatibility and authorization testing.
- Ensure dashboard reads independently authenticate/authorize teachers and return only permitted data; a secure approval write does not repair an unprotected dashboard read.

### API request and enforcement

The browser should submit only the target `studentCode`, `classCode`, `level` and decision (`approvalStatus`). This is a proposed API contract, not a new configured endpoint. Preserve the existing downstream flow body; the backend constructs its reviewer fields and key.

Before any flow call or write, the API must:

1. Verify the authenticated per-user principal. Reject missing, expired, invalid or wrong-audience authentication. Do not accept a shared `X-GGR-Key`, `approverEmail`, submitted role, class list or browser session object as identity proof.
2. Map the principal to an authoritative teacher record; require current active status and dashboard access. Load current role and permitted classes server-side on each authorization decision. Only an authoritative admin role may authorize cross-class access.
3. Validate nonempty, bounded student/class identifiers against the roster, ensure an active student belongs to the requested class, and check the teacher may review that class. Validate integer level and allowed checkpoint state. Confirm the supported checkpoint-level range with the flow owner before rollout: the repair spec uses 2–5, whereas the checkpoint UI normalization permits 1–6. Do not default invalid levels.
4. Allow only the supported decision enum (`approved`, `retake_requested`, `rejected` in current client code); confirm flow support and transition rules, including retakes, before enabling each. Reject malformed/unknown fields or explicitly discard legacy reviewer/key/timestamp fields so they can never control authority.
5. Recompute `ProgressKey = UPPER(ClassCode)|UPPER(StudentCode)|Level` from validated authoritative identifiers. Derive `approverName`, `approverEmail` and UTC `approvalTimestamp` server-side from the verified teacher and server clock. Send the existing eight-field flow payload, not client-supplied reviewer assertions.
6. Deny unauthorized requests **before invoking the flow**. Apply request size/rate limits and safe lookup escaping/parameterization. Keep authorization checks in place for both approve and retake paths.
7. Require explicit durable write confirmation before reporting success. Map failures to sanitized status/error codes and a correlation ID; never forward raw flow URLs, signatures, service keys, tokens, stack traces or raw upstream errors to clients or logs. Redact sensitive request data; record only necessary access-controlled audit metadata.

The flow must retain server-side validation and canonical-key checks, update only the intended progress row, and preserve approval ownership against student SaveProgress writes as specified in the repair spec.

### Dashboard compatibility and rollout

- Keep existing direct-mode URL/API-key injection, endpoint precedence, payload fields and fail-closed unconfigured approvals unchanged in this follow-up. Removing injection now would break deployment without providing authentication.
- Implement and test the backend/authentication first in a separate deployment. Then explicitly change approval transport to the authenticated API, not an unauthenticated forwarding proxy or merely a replacement URL using the shared browser key.
- After confirmed approval persistence, rehydrate using the existing dashboard pattern: [checkpoint-approval.js:114–117](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/checkpoint-approval.js#L114-L117) → [dashboard-state.js:788–795](https://github.com/JAVA-BT10/wa-gold-rush/blob/f7456c30d89eb8d0f1475e22b30ee09737da2ad7/teacher/dashboard-state.js#L788-L795). Keep failed writes from showing success; distinguish confirmed write with failed read-back from a failed write. Do not optimistically persist approval authority in browser storage.
- Coordinate removal of approval credentials from generated Pages config with backend cutover. If the service key is shared with other browser flows, migrate/separate those uses before claiming the key is confidential.
- Rotate previously exposed/disclosed trigger signatures and service keys, invalidate old credentials, redeploy and verify old URLs/keys cannot write. Purge stale artifacts/caches where possible; assume downloaded old assets remain public. Rotation in direct mode alone just publishes the replacement.
- Rollback must not silently re-expose new server credentials: fail closed or use an explicitly reviewed temporary direct-mode risk decision.

### Required migration acceptance tests

These are future backend/integration deployment gates, **not covered by the current mocked repository tests**:

| Case | Required result |
| --- | --- |
| Missing/invalid/expired token or session; wrong issuer/audience | Deny, zero flow calls and zero writes. |
| Forged `approverEmail`, `role=admin`, sessionStorage classes, timestamp or ProgressKey; shared key alone | Cannot impersonate or elevate access; reject or ignore untrusted fields and derive authoritative fields. |
| Inactive teacher, revoked dashboard access, unauthorized class, stale role after revocation | Deny before flow invocation; verify with call-count and persistence assertions. |
| Unknown/inactive student, student/class mismatch, malformed identifiers, fractional/out-of-range level, unsupported decision/transition | Validation failure, zero writes; no default-level fallback. |
| Cross-origin cookie request without valid CSRF protection; non-browser request bypassing CORS | CSRF rejected where applicable; authentication/authorization still enforced independently of Origin. |
| Active authorized teacher approves and requests retake; verified admin reviews another class | Exactly the intended row changes; canonical key and reviewer/server time correct; existing flow body accepted; retake state correct. |
| Flow rejection, timeout, malformed success or read-back failure | No false success, no blind duplicate write after unknown outcome; bounded reconciliation against authoritative state. |
| Successful write followed by authorized dashboard rehydration on another device | Persisted decision read back through existing dashboard; no local-only approval authority. |
| Built assets, browser source/network, logs and errors after cutover; replay of old exposed credentials | No migrated flow URL/service key in client artifacts or diagnostics; old credentials denied; other flows remain functional. |

## Verification and limitations

The existing Node test suite is `node --test tests/wiring-reliability.test.js`. Targeted approval/config tests use `node --test --test-name-pattern='approval|pages deploy|runtime config' tests/wiring-reliability.test.js`. During this follow-up, the targeted run passed all 7 selected tests; after the final test-name clarifications, the full suite passed all 62 tests. Tests check endpoint precedence, unavailable approval behavior, payload/read-back wiring through mocks, and synthetic browser-readable generated configuration. They do not inspect deployed flow definitions, prove per-user authentication, or verify live Lists writes. The runtime artifact renderer simulates the workflow; source checks are not an end-to-end Pages deployment.

GitHub Actions run **38694033983**, deploy job **116286374994**, reported success for merge SHA `4327d801c56c9cb11018325c052d14353a35ec77`. Reviewed job logs show deployment success, not an approval-flow invocation or live-flow success. No CI failure is inferred. No live credentials, signed trigger URLs or production calls are needed for this audit.
