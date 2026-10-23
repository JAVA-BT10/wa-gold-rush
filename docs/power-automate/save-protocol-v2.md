# Save protocol v2: server-authoritative revision, idempotency and reset generation

> **Status:**
> - **Client:** implemented, gated OFF (`featureFlags.saveProtocolV2`). Code is in `shared/save-protocol.js` and `shared/sharepoint-sync.js`.
> - **Server:** **not implemented in the tenant.** The reference semantics live in `tests/support/reference-save-server.js`. That file is an in-memory **mock** used by `node --test`; it does not prove that SharePoint / Power Automate can provide the same guarantees.
> - **Before turning the flag ON:** the tenant must pass the acceptance rows in [release-and-acceptance](../operations/release-and-acceptance.md#tenant-acceptance-matrix).
>
> This document deliberately corrects earlier advice. A client that increments its own `saveRevision` and has the server reject `incoming <= stored` is **not sufficient**:
> - Two devices (or two concurrent requests) can both send `n+1`. The second either overwrites the first (lost update) or is wrongly rejected after a lost response.
> - A plain read → check → write in a flow also races between runs.

## 1. Concepts

| Term | Owner | Meaning |
| --- | --- | --- |
| `storageSchemaVersion` / snapshot `schemaVersion` | client | The *shape* of the saved data. It is **separate** from the concurrency revision. |
| `revision` | **server** | Monotonic integer per `ProgressKey` row, assigned by the server on each accepted write. The client only echoes it back as `baseRevision`. |
| `baseRevision` | client (sealed) | The revision the client's change is based on. `null` = create-only: "I believe no row exists". |
| `runGeneration` / `runId` | **server** for advancement | Identifies the current run (game life) of one level. Only an authorised reset (`GGR_ResetLevelProgress`) advances the generation. A client-side restart cannot. |
| `saveRequestId` | client | Immutable ID per captured save. Kept across all retries. |
| `contentHash` | client, verified or recomputed by server | Canonical-JSON, non-cryptographic 53-bit (cyrb53-style) hash (`shared/level-save-store.js` `hashValue`) of the payload **excluding** `saveRequestId`, `clientTimestampUtc`, `clientVersion`, `contentHash`, `baseRevision`. It is an equality fingerprint, **not** a security control. The server should recompute it from the received payload with the same canonicalisation or, if it cannot, store and compare the client value **and** the raw payload length. Verify feasibility in the tenant. |

## 2. Client behaviour (implemented, gated)

1. **Capture.** The snapshot is deep-copied and frozen. The payload carries `level` (the level played), `protocolVersion:2`, `runGeneration`, `runId`, `startingNetWorth` and `contentHash`. It does not carry `baseRevision` yet. Payloads are coalesced per `progressKey#g<generation>` until sealed.
2. **Seal at first dispatch.** `baseRevision` is set from the local envelope's last **acknowledged** revision and the payload is frozen. Every retry re-sends the sealed payload byte for byte. Only one sealed request per key is in flight; later captures wait.
3. **Classify the response** (`classifyResponse`):

   | Server response | Outcome | Client action |
   | --- | --- | --- |
   | `ok:true`, `protocolVersion:2`, matching `saveRequestId` / `progressKey` / `runGeneration`, integer `revision` | `confirmed` | `recordAcknowledgement` stores the revision (monotonic, same run). Status becomes `synced`, or `pending` if newer local changes exist. |
   | HTTP 2xx without a v2 acknowledgement (e.g. the legacy flow) | `unconfirmed` | **Not** marked saved. The request is held and reported as "cloud save not verified". |
   | `revision_conflict` / `row_exists` / `precondition_failed`, or HTTP 409/412 | `conflict` | Held in `wa_gr_sync_conflicts`. No automatic retry and no overwrite. The student sees a refresh/reconcile choice. |
   | `generation_stale` | `stale_generation` | Discarded as superseded by a reset. |
   | `request_id_reused` | `rejected` | Quarantined. |
   | Network failure / timeout / 5xx / `ok:false` without a v2 code | `defer` | Existing retry and unknown-outcome handling. The same ID and `baseRevision` are kept. |

4. **Reset.** "Restart This Level" discards pending and queued saves for that key (`superseded_by_reset`). The client then starts a new local run. Under v2 this new local run cannot advance the server generation, so its saves fail closed until `GGR_ResetLevelProgress` exists.
5. **Rollback safety:**
   - With the flag OFF, v2 queue items are **held**, not sent to a legacy flow.
   - With the flag ON, legacy queue items are **quarantined intact** (`legacy_item_held_v2_active`), never upgraded to the current revision or generation. This is a manual-reconciliation hold, not an automatic retry: turning the flag OFF must not replay an obsolete unconditional capture over a newer v2 save. The existing quarantine retains at most 50 entries; export recovery evidence before capacity is reached.

## 3. Server algorithm (required; reference = mock)

The checks must run in **this order**.

```text
validate request shape and auth; recompute ProgressKey; verify roster ownership/class/level entitlement
1. Idempotency (BEFORE stale checks):
   a. receipt := GGR_SaveReceipts[SaveRequestId]
      - exists and (ProgressKey, ContentHash, BaseRevision) match → return the stored original response (+ deduplicated:true)
      - exists and differs → request_id_reused
   b. row := GGR_StudentProgress[ProgressKey]
      - SaveRequestId ∈ row.RecentRequests (with matching ContentHash/RunGeneration) → return ack with the recorded revision (+ deduplicated:true), and repair the missing receipt
      - present with different content → request_id_reused
2. Generation:
   - request.runGeneration < row.RunGeneration → generation_stale
   - request.runGeneration > row.RunGeneration → precondition_failed (only an authorised reset may advance it)
3. Compare-and-swap:
   - baseRevision = null and row exists → row_exists
   - baseRevision ≠ row.Revision or runId ≠ row.RunId → revision_conflict / precondition_failed
4. Conditional write (one atomic item update guarded by the row ETag):
   Revision = Revision + 1, data fields, LastSaveRequestId, RecentRequests (bounded ring of {id, hash, revision}), ContentHash
   - ETag mismatch (HTTP 412) → re-read and restart from step 1
   - create path: Create item on a column with unique values enforced; a duplicate failure → re-read and restart from step 1
5. Write the receipt (best effort after the row; see crash recovery)
6. Respond { ok:true, protocolVersion:2, saveRequestId, progressKey, runGeneration, revision }
```

### Why each piece is needed

- **Dedup before stale.** If request A was accepted but its response was lost, the retry of A carries an old `baseRevision`. Without step 1, A would be reported as a conflict even though it was acknowledged. Step 1 returns A's *original* success, **even after newer writes B, C, …**, provided the receipt (or the row's recent-request ring) still holds A.
- **Same ID, different content → reject.** This stops a buggy or replayed client from smuggling new data under an old acknowledgement.
- **Unique `ProgressKey` + create-only `baseRevision:null`.** Two first saves racing from two devices cannot both create a row; the loser gets `row_exists`.
- **ETag / If-Match.** This closes the read → check → write race between concurrent flow runs. Two devices sending the same `baseRevision` produce one success and one `revision_conflict`. There is no last-writer data loss.
- **Generation.** A delayed pre-reset request (older generation) can never resurrect the old game.

### Crash recovery between the row write and the receipt

SharePoint offers no multi-list transaction, so the row update and the receipt create cannot be atomic together. The design handles this as follows:

- **Row first, as the commit point.** `RecentRequests` is inside the **same** item update as the data, so dedup of recent requests is atomic with the write.
- **Then the receipt.** If the receipt write fails, a retry is still recognised via `RecentRequests`, and the missing receipt is repaired.
- **Retention limits** (document these to teachers and operators):
  - `RecentRequests` holds the last *N* request IDs. **N = 20 is proposed**; the mock uses N = 1 via `LastSaveRequestId`. Verify column size limits; a multi-line text column is suggested.
  - Receipts are retained for *T* days (**proposed: the term length**), then purged by a scheduled flow.
  - A retry older than both windows can no longer be recognised. It gets an honest `revision_conflict`, never a silent re-apply, because its `baseRevision` is stale. The client treats that as a conflict and does not mark the write as lost.
  - Because only one sealed request per key is in flight per device, this only happens after very long offline periods.

### Tenant feasibility: actions to verify (do not assume)

These are capabilities to **verify** in the tenant. Use the real names of the actions in your flow; this list does not supply flow JSON.

| Need | Candidate mechanism to verify |
| --- | --- |
| Conditional update | **Send an HTTP request to SharePoint** (SharePoint connector), using `MERGE`/`PATCH` on `_api/web/lists/getbytitle('<list>')/items(<id>)` with header `IF-MATCH: <etag from the read>`. Confirm that a mismatch returns HTTP 412 and that the flow branches on it. The standard *Update item* action does **not** expose If-Match; verify before relying on it. |
| Unique `ProgressKey` | List column setting *Enforce unique values* (requires an indexed column). Confirm that a duplicate create fails and how the error surfaces in the flow. |
| Unique `SaveRequestId` in receipts | The same setting on `GGR_SaveReceipts.SaveRequestId`. |
| Serialisation alternative | Trigger *Concurrency control* (degree of parallelism 1). This lowers race risk but does **not** replace ETag checks: it does not survive retries or parallel instances of other flows. It also limits throughput, so measure it. |
| Bounded response | A *Response* action on every branch, plus run-after on failure/timeout. Keep the run well under the client timeout; measure it. |

The receipts list `GGR_SaveReceipts` is **separate** from `GGR_StudentProgress`. It is one list for all levels; there are no per-level lists. Suggested columns:

- `SaveRequestId` (unique)
- `ProgressKey`
- `RunGeneration`
- `BaseRevision`
- `ResultRevision`
- `ContentHash`
- `ResponseJson` (bounded)
- `CreatedUtc`

## 4. Reset generation

`GGR_ResetLevelProgress` (planned) performs the reset as one conditional update (If-Match):

- Archive the snapshot.
- `RunGeneration += 1`, new server `RunId`, `Revision += 1`, `StartingNetWorth` = the configured start for that level.
- Clear `RecentRequests`.
- Audit the change.

The client adopts the new run through restore (`GGR_GetStudentProgress`). After that:
- old queued requests return `generation_stale` and are discarded;
- other levels, PIN/credentials and `ProgressedLevel` are untouched.

## 5. Protocol test vectors

The mock tests in `tests/per-level-architecture.test.js` exercise these vectors against `ReferenceSaveServer`. Re-run them as **tenant acceptance**, recording the responses (redacted). Legend: K = `6B|SC-1|2`, G = generation, R = revision.

| # | Setup | Request | Expected |
| --- | --- | --- | --- |
| V1 | no row | A: base=null, G1 | ok, R1 |
| V2 | row R1 | B: base=null | `row_exists`, currentRevision 1 |
| V3 | row R1 | device X: base=1; device Y: base=1 (different content) | X ok R2; Y `revision_conflict` (currentRevision 2) |
| V4 | V1 then response lost | retry A (same id, content, base=null) | ok R1, `deduplicated:true` |
| V5 | A ok R1, B ok R2, C ok R3 | retry A | ok **R1** `deduplicated:true` (not stale, not reapplied) |
| V6 | A ok | A' = same id, different content | `request_id_reused` |
| V7 | row commit ok, receipt write failed | retry A | ok `deduplicated:true` (row ring), receipt repaired |
| V8 | row G1 R3; reset → G2 | old queued request G1 base=3 | `generation_stale` |
| V9 | row G1 | request G2 (client-invented restart) | `precondition_failed` |
| V10 | row at G2 after reset | base=R of G2 run, runId of G2 | ok |
| V11 | legacy flow (no v2) | any v2 request | client: `unconfirmed`, not saved |
| V12 | timeout | any | client: unknown → retry same id/base; never "not saved" |

## 6. Legacy compatibility

- With the flag OFF, the wire format is unchanged apart from per-level correctness, `progressKey` and an optional `run` block inside the snapshot JSON.
- Existing v1 status handling is unchanged: 400/410/422 or `ok:false` → quarantine; 5xx or network → retry.
- **Never** run a shared-slot writer, i.e. an old client build, against vNext rows. A rollback must keep the per-level client.
