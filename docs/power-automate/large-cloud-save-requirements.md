# Large cloud saves: tenant implementation requirements

The owner selected a Department SharePoint document library for full saves,
with `GGR_StudentProgress` retaining the per-level index. **The library and
flows are not implemented or deployed by this repository.** No source file
contains the private folder URL. Do not enable the pilot flags until the tenant
implementation has passed the acceptance cases below.

The owner-supplied Level 2 and 3 backups contain snapshots of about 326,000 and
1,078,000 JSON characters. Their complete round histories must not be put into
a List text column, truncated, or replaced by rounded economy summaries.
Preserve the current `ProgressionMarkersJson` for historical compatibility.
For new large saves, use immutable documents rather than rewriting the old
column. A document contains the complete save, including history, and needs to
be read back and validated before the List row points to it.

## Required index and document properties

- One uniquely enforced canonical `ProgressKey` per class/student/level.
  Existing duplicate rows must be resolved manually, never selected by score,
  timestamp or round.
- Each committed row needs a server revision, run identity/generation, a
  reference to its immutable complete snapshot document, and enough durable
  information to recover an accepted request whose response was lost.
  Actual internal names, column types and uniqueness must be confirmed in the
  tenant before making changes.
- Store complete request bindings and receipts in protected durable storage
  with sufficient capacity for large saves. Do not place an entire large
  request into a single List text field. Retain the exact source JSON and do not
  accept a client-supplied hash as proof that two requests are identical.
- Document names/references must be generated and validated by the server.
  Reject path traversal and cross-slot references. Do not accept an arbitrary
  document URL or SharePoint path supplied by a browser.
- Restrict the folder and flow access according to Department policy. The
  browser-visible API key is shared, and is not proof of an individual
  student's identity. The owner's pilot trust decision does not change this.

## Save ordering and retrieval

`GGR_SaveProgress` must validate the existing client v2 payload and the active
roster, recompute the key, check for duplicates and verify the full snapshot's
owner, level and run. It must preserve teacher-owned approval fields. On each
new request, first create a uniquely named immutable document containing the
complete snapshot and verify its contents. Compare the requested base revision
to the current row and commit the row's new revision and document reference
using an atomic SharePoint ETag conditional update. A first insert must enforce
unique keys. A losing writer leaves its unreferenced document for controlled
cleanup; it must not replace the winning document. Do not report success until
the List points to the exact durable document and the response can be recovered
after a timeout.

Deduplicate `saveRequestId` before conflict checks against a durable binding of
the **whole** immutable request. The row update and enough retry-recovery
metadata must commit atomically; an interrupted receipt write must be repairable
before later saves evict that evidence. An old request, changed request body,
failed document upload, duplicate row, stale generation or ETag failure must
not overwrite a committed snapshot or return a success acknowledgement.
Existing unconditional writers and old clients must be refused server-side
before the pilot; merely holding the new client's queue is not sufficient.

`GGR_GetStudentProgress` must return only the exact requested slot, never the
teacher dashboard's dataset. For one validated row, read the referenced
document and return the full `ggr.getStudentProgress.v2` save envelope and
server revision; validate identity, key, level, generation and run ID. If an
old row has no document, its existing `ProgressionMarkersJson` may be examined
and converted only when the converter's requirements are satisfied. Never
invent a run identity or revision for an unvalidated row. A missing document,
truncated JSON, unauthorized caller, duplicate, error or timeout is an error,
not `found:false`. `found:false` is reserved for a successful complete
exact-key query with no row.

The current browser request and response shapes are described in
[the read-only pilot guide](read-only-restore-pilot.md) and
[save protocol v2](save-protocol-v2.md). Keep `X-GGR-Key` verification and
the existing login experience. `pilotSharedKeyProgress` is an explicit,
default-off pilot option and does not itself deploy this server contract.

## Acceptance before enabling

1. Back up the Lists, documents and the Demo browser exports. Preserve local
   and cloud copies separately; do not choose a winner based on round number.
2. Verify exact-length and full-content document round trips for small,
   326,000-character, 1,078,000-character and larger synthetic saves; check
   document and Power Automate connector limits, browser quota and response
   size in the actual tenant. Do not use the owner's only copies for tests.
3. Verify two devices from one base: only one conditional update succeeds;
   the other receives a conflict and retains its local save. Repeat with
   simultaneous create, lost response, retry, duplicate request ID with
   changed body, throttling, missing document and interrupted upload.
4. Verify Levels 2–5 separately, old snapshots, duplicate keys and preservation
   of teacher approvals. Verify other students' records are not returned.
5. Test an authorized operator reconciliation of the Demo Level 2 local and
   cloud copies; separately preserve Level 3 and 4 local copies. Only then
   perform a two-device save/restore pilot. The browser test model is not
   evidence that Power Automate or SharePoint implement these guarantees.
