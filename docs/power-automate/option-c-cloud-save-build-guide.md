# Option C cloud saves: List, column and flow build guide

This guide restores Device A → save → Device B → restore for Levels 2–5 with
the existing Microsoft Lists, the existing `X-GGR-Key` API key and the existing
student login. No document library is used.

## What the game now sends

| Copy | Contents |
|---|---|
| Local save and exported backup | Everything, including **every** round. Never trimmed. |
| Cloud save (`ProgressionMarkersJson`) | Current game, investment profile, `strategyMetrics`, `roundMetrics`, checkpoint, quiz and approval evidence, run identity and the **last 20 rounds**. |

The game refuses to upload a cloud save over 60,000 characters (the List limit
is 63,999). The owner's Demo saves measure 14,667 (Level 2, round 1,149) and
22,267 (Level 3, round 2,307) characters. A device that adopts a newer cloud
save keeps every older round it already held for that run.

New snapshot fields (see `shared/level-save-store.js`):

- `strategyMetrics`: `safeInvestmentTotal`, `mediumInvestmentTotal`,
  `deepInvestmentTotal`, `safeDigs`, `mediumDigs`, `deepDigs`. The strategy
  label is calculated from these, never from round history.
- `roundMetrics`: `roundsRecorded`, `profitableRounds`, `lossRounds`,
  `breakEvenRounds`, `totalProfit`, `totalLoss`, `largestProfit`, `largestLoss`.
- `historyRetention`: `mode` (`full` or `recent`), `limit`, `recordedRounds`,
  `retainedRounds`.
- Reserved for Level 6 (validated, not yet produced): `timelinePosition`
  (object), `eventJournal` (at most 200 entries, each with `eventType`) and
  `assessmentEvidence` (object).

Existing saves are backfilled once from their complete local history, so the
totals cover every round already played.

## Step 1 – Back up first

1. Open `GGR_StudentProgress` → **Export** → **Export to CSV**. Keep the file
   somewhere private.
2. On the home computer, open each Demo level and use **Export backup**.

## Step 2 – Columns on `GGR_StudentProgress`

Create each column with **exactly** this name (no spaces) so its internal name
matches the flow expressions below.

| Column | Type | Settings |
|---|---|---|
| `Revision` | Number | 0 decimal places |
| `RunGeneration` | Number | 0 decimal places |
| `RunId` | Single line of text | |
| `StartingNetWorth` | Number | Automatic decimals |
| `LastSaveRequestId` | Single line of text | |
| `LegacyProgressionMarkersJson` | Multiple lines of text | **Plain text**; "Append changes" = No |

Check existing columns:

- `ProgressionMarkersJson` must be **Multiple lines of text → Plain text**
  (List settings → click the column). If it shows "Enhanced rich text",
  change it to Plain text.
- `ProgressKey`: List settings → **Indexed columns** → create an index on
  `ProgressKey`. Then open the column and set **Enforce unique values = Yes**.
  If SharePoint refuses because of duplicates, sort by `ProgressKey`, keep the
  row you trust, export the others to CSV and delete them, then try again.

## Step 3 – New List `GGR_SaveReceipts`

Create a blank List named `GGR_SaveReceipts` in the **same site** as
`GGR_StudentProgress`.

| Column | Type | Settings |
|---|---|---|
| `Title` | (built-in) | stores the saveRequestId |
| `SaveRequestId` | Single line of text | Indexed, Enforce unique values = Yes |
| `ProgressKey` | Single line of text | Indexed |
| `RunGeneration` | Number | 0 decimals |
| `BaseRevision` | Number | 0 decimals |
| `ResultRevision` | Number | 0 decimals |
| `ContentHash` | Single line of text | |
| `ResponseJson` | Multiple lines of text | Plain text |

## Step 4 – New flow `GGR_SaveProgress` (v2)

Build a **new** flow (keep the old one until Step 7). Name each action exactly
as written; the expressions refer to those names.

1. **Trigger** – *When a HTTP request is received*. Who can trigger: same as
   your current `GGR_SaveProgress`. Method: `POST`. Request Body JSON Schema:

   ```json
   {
     "type": "object",
     "properties": {
       "protocolVersion": { "type": "integer" },
       "studentCode": { "type": "string" },
       "classCode": { "type": "string" },
       "level": { "type": "integer" },
       "progressKey": { "type": "string" },
       "saveRequestId": { "type": "string" },
       "runGeneration": { "type": "integer" },
       "runId": { "type": "string" },
       "startingNetWorth": { "type": ["number", "null"] },
       "baseRevision": { "type": ["integer", "null"] },
       "contentHash": { "type": "string" },
       "progressionMarkersJson": { "type": "string" },
       "currentRound": { "type": "integer" },
       "currentCash": { "type": "number" },
       "currentAssets": { "type": "number" },
       "netWorth": { "type": "number" },
       "score": { "type": "number" }
     },
     "required": ["protocolVersion", "studentCode", "classCode", "level", "progressKey",
                  "saveRequestId", "runGeneration", "runId", "contentHash", "progressionMarkersJson"]
   }
   ```

2. **Copy your existing API-key check** from the current `GGR_SaveProgress`
   (the condition on the `X-GGR-Key` header and its 401 response).

3. **Compose** named `ExpectedKey`:

   ```
   concat(toUpper(trim(triggerBody()?['classCode'])), '|', toUpper(trim(triggerBody()?['studentCode'])), '|', string(triggerBody()?['level']))
   ```

4. **Condition** named `Request_valid`. Use *Edit in advanced mode*:

   ```
   @and(equals(triggerBody()?['protocolVersion'], 2), equals(triggerBody()?['progressKey'], outputs('ExpectedKey')), greaterOrEquals(triggerBody()?['level'], 2), lessOrEquals(triggerBody()?['level'], 5), greaterOrEquals(triggerBody()?['runGeneration'], 1), not(contains(outputs('ExpectedKey'), '''')), not(empty(triggerBody()?['runId'])), lessOrEquals(length(triggerBody()?['progressionMarkersJson']), 63999))
   ```

   **If no** → *Response* status `400`, body
   `{"ok":false,"protocolVersion":2,"code":"invalid_request"}` → *Terminate*
   (Succeeded). Old queued saves from earlier game versions are rejected here
   and kept on the student's device.

5. **Roster check** – if your current `GGR_SaveProgress` checks the student
   against `GGR_Students`, copy that check here unchanged (its failure
   Response must be status `403`). If it has none, skip this step.

6. **Get items** named `Get_receipt` → List `GGR_SaveReceipts`, Filter Query
   `SaveRequestId eq '@{triggerBody()?['saveRequestId']}'`, Top Count `1`.
   **Condition** named `Receipt_exists`: `length(body('Get_receipt')?['value'])`
   is greater than `0`. **If yes**:
   - **Condition** (advanced):

     ```
     @and(equals(first(body('Get_receipt')?['value'])?['ProgressKey'], outputs('ExpectedKey')), equals(first(body('Get_receipt')?['value'])?['ContentHash'], triggerBody()?['contentHash']), equals(int(first(body('Get_receipt')?['value'])?['RunGeneration']), triggerBody()?['runGeneration']))
     ```

     - Yes → Response `200`, body:
       `@{setProperty(json(first(body('Get_receipt')?['value'])?['ResponseJson']), 'deduplicated', true)}`
     - No → Response `409`, body
       `{"ok":false,"protocolVersion":2,"code":"request_id_reused"}`
   - Terminate (Succeeded).

7. **Get items** named `Get_row` → List `GGR_StudentProgress`, Filter Query
   `ProgressKey eq '@{outputs('ExpectedKey')}'`, Top Count `2`.
   - **Condition** `length(body('Get_row')?['value'])` greater than `1` → Response
     `409` `{"ok":false,"protocolVersion":2,"code":"precondition_failed"}` → Terminate.

8. **Compose** named `Row` with `first(body('Get_row')?['value'])`, and
   **Compose** named `RowRevision` with:

   ```
   if(equals(outputs('Row'), null), 0, int(coalesce(outputs('Row')?['Revision'], 0)))
   ```

   A row with an empty `Revision` is an old (pre-v2) row: it counts as
   revision 0 and its JSON is preserved in Step 11.

9. **Lost-response recovery** – Condition (advanced):

   ```
   @and(greater(outputs('RowRevision'), 0), equals(outputs('Row')?['LastSaveRequestId'], triggerBody()?['saveRequestId']), equals(outputs('Row')?['RunId'], triggerBody()?['runId']), equals(outputs('Row')?['ProgressionMarkersJson'], triggerBody()?['progressionMarkersJson']))
   ```

   **If yes** → Response `200`:

   ```json
   {"ok":true,"protocolVersion":2,"saveRequestId":"@{triggerBody()?['saveRequestId']}","progressKey":"@{outputs('ExpectedKey')}","runGeneration":@{triggerBody()?['runGeneration']},"revision":@{outputs('RowRevision')},"deduplicated":true}
   ```

   then *Create item* in `GGR_SaveReceipts` exactly as in Step 13, then
   Terminate (Succeeded).

10. **Conflict checks** – Condition named `Is_create`:
    `triggerBody()?['baseRevision']` is equal to expression `null`.
    - **Yes (create)**: Condition `outputs('RowRevision')` greater than `0` →
      Response `409`:
      `{"ok":false,"protocolVersion":2,"code":"row_exists","currentRevision":@{outputs('RowRevision')},"currentGeneration":@{int(outputs('Row')?['RunGeneration'])}}`
      → Terminate.
    - **No (update)**: Condition (advanced):

      ```
      @or(not(equals(outputs('RowRevision'), triggerBody()?['baseRevision'])), not(equals(outputs('Row')?['RunId'], triggerBody()?['runId'])))
      ```

      If yes → Response `409`:
      `{"ok":false,"protocolVersion":2,"code":"revision_conflict","currentRevision":@{outputs('RowRevision')}}`
      → Terminate. Then Condition `triggerBody()?['runGeneration']` less than
      `int(coalesce(outputs('Row')?['RunGeneration'], 1))` → Response `409`
      `{"ok":false,"protocolVersion":2,"code":"generation_stale"}` → Terminate.

11. **Compose** named `NewRevision`: `add(outputs('RowRevision'), 1)`.
    **Compose** named `RowBody`, entered as one expression (the expression
    editor, not typed JSON, so any characters in the save are escaped
    correctly):

    ```
    setProperty(setProperty(setProperty(setProperty(setProperty(setProperty(setProperty(json('{}'), 'Revision', outputs('NewRevision')), 'RunGeneration', triggerBody()?['runGeneration']), 'RunId', triggerBody()?['runId']), 'StartingNetWorth', triggerBody()?['startingNetWorth']), 'LastSaveRequestId', triggerBody()?['saveRequestId']), 'ProgressionMarkersJson', triggerBody()?['progressionMarkersJson']), 'LegacyProgressionMarkersJson', if(and(not(equals(outputs('Row'), null)), equals(outputs('RowRevision'), 0), empty(outputs('Row')?['LegacyProgressionMarkersJson'])), outputs('Row')?['ProgressionMarkersJson'], outputs('Row')?['LegacyProgressionMarkersJson']))
    ```

    The last property copies an old row's original JSON into
    `LegacyProgressionMarkersJson` the first time it is upgraded and never
    overwrites an already-preserved copy.

12. **Write the row** – Condition `outputs('Row')` is equal to expression `null`:
    - **Yes (no row)** → *Send an HTTP request to SharePoint* named `Create_row`:
      Site Address: the site of `GGR_StudentProgress`; Method `POST`;
      Uri `_api/web/lists/GetByTitle('GGR_StudentProgress')/items`;
      Headers `Accept: application/json;odata=nometadata` and
      `Content-Type: application/json;odata=nometadata`;
      Body:
      `@{setProperty(setProperty(outputs('RowBody'), 'Title', outputs('ExpectedKey')), 'ProgressKey', outputs('ExpectedKey'))}`.
      Add a parallel branch after it whose **Configure run after** is
      *has failed* → Response `409`
      `{"ok":false,"protocolVersion":2,"code":"row_exists"}` → Terminate.
      (Enforce unique values on `ProgressKey` makes the second of two
      simultaneous creates fail here.)
    - **No (row exists)** → *Send an HTTP request to SharePoint* named
      `Update_row`: Method `POST`;
      Uri `_api/web/lists/GetByTitle('GGR_StudentProgress')/items(@{outputs('Row')?['ID']})`;
      Headers `Accept: application/json;odata=nometadata`,
      `Content-Type: application/json;odata=nometadata`,
      `IF-MATCH: @{outputs('Row')?['@odata.etag']}`,
      `X-HTTP-Method: MERGE`; Body `@{outputs('RowBody')}`.
      Parallel branch with **Configure run after** = *has failed* → Response
      `409` `{"ok":false,"protocolVersion":2,"code":"revision_conflict"}` →
      Terminate. `IF-MATCH` makes SharePoint reject the write (412) if any
      other save changed the row after Step 7, so two devices can never both
      win.

    After the successful write, copy the **Update item** action from your
    current `GGR_SaveProgress` that fills the dashboard columns (round, cash,
    assets, net worth, score, checkpoint fields, badges), point its Id at the
    row just written (`outputs('Row')?['ID']`, or for a new row
    `body('Create_row')?['Id']`), and **clear its `ProgressionMarkersJson`
    box** so it can never overwrite the save.

13. **Create item** → `GGR_SaveReceipts`: Title and SaveRequestId =
    `triggerBody()?['saveRequestId']`, ProgressKey = `outputs('ExpectedKey')`,
    RunGeneration = `triggerBody()?['runGeneration']`, BaseRevision =
    `triggerBody()?['baseRevision']`, ResultRevision = `outputs('NewRevision')`,
    ContentHash = `triggerBody()?['contentHash']`, ResponseJson = the success
    body of Step 14 (without `deduplicated`).

14. **Response** `200`:

    ```json
    {"ok":true,"protocolVersion":2,"saveRequestId":"@{triggerBody()?['saveRequestId']}","progressKey":"@{outputs('ExpectedKey')}","runGeneration":@{triggerBody()?['runGeneration']},"revision":@{outputs('NewRevision')}}
    ```

## Step 5 – New flow `GGR_GetStudentProgress`

1. **Trigger** – *When a HTTP request is received*, Method `POST`, schema:

   ```json
   {
     "type": "object",
     "properties": {
       "contractVersion": { "type": "string" },
       "mode": { "type": "string" },
       "classCode": { "type": "string" },
       "studentCode": { "type": "string" },
       "level": { "type": "integer" },
       "progressKey": { "type": "string" }
     },
     "required": ["classCode", "studentCode", "level"]
   }
   ```

2. Copy the API-key check, then the `ExpectedKey` Compose from Step 4.3.
3. Condition (advanced) named `Valid`:

   ```
   @and(greaterOrEquals(triggerBody()?['level'], 2), lessOrEquals(triggerBody()?['level'], 5), not(contains(outputs('ExpectedKey'), '''')))
   ```

   If no → Response `400` `{"ok":false,"code":"invalid_request"}` → Terminate.
4. Roster check as in Step 4.5 (if you use one).
5. **Get items** named `Get_row` → `GGR_StudentProgress`, Filter Query
   `ProgressKey eq '@{outputs('ExpectedKey')}'`, Top Count `2`. Add a parallel
   branch with **Configure run after** = *has failed* / *has timed out* →
   Response `502` `{"ok":false,"code":"lookup_failed"}` → Terminate. (A failed
   lookup must never be reported as "no save".)
6. Compose `Row` = `first(body('Get_row')?['value'])`; Compose `RowRevision`
   exactly as Step 4.8.
7. **Condition** `triggerBody()?['contractVersion']` is equal to
   `ggr.getStudentProgress.v2`:
   - **Yes – full save restore**:
     - Condition (advanced)
       `@or(not(equals(triggerBody()?['mode'], 'full_save')), not(equals(triggerBody()?['progressKey'], outputs('ExpectedKey'))))`
       → Response `400` `{"ok":false,"code":"invalid_request"}` → Terminate.
     - Condition `length(body('Get_row')?['value'])` greater than `1` →
       Response `409` `{"ok":false,"code":"duplicate_rows"}` → Terminate.
     - Condition `outputs('RowRevision')` equal to `0` → Response `200`:
       `{"ok":true,"contractVersion":"ggr.getStudentProgress.v2","progressKey":"@{outputs('ExpectedKey')}","found":false}`
       → Terminate.
     - Response `200`, body (expression):

       ```
       setProperty(setProperty(setProperty(setProperty(json('{"ok":true,"contractVersion":"ggr.getStudentProgress.v2","found":true}'), 'progressKey', outputs('ExpectedKey')), 'revision', outputs('RowRevision')), 'runGeneration', int(outputs('Row')?['RunGeneration'])), 'progressionMarkersJson', outputs('Row')?['ProgressionMarkersJson'])
       ```
   - **No – level unlock (checkpoint compatibility)**: Response `200`, body:

     ```
     setProperty(json('{"ok":true}'), 'records', if(equals(outputs('Row'), null), json('[]'), createArray(setProperty(setProperty(setProperty(setProperty(json('{}'), 'studentCode', triggerBody()?['studentCode']), 'classCode', toUpper(triggerBody()?['classCode'])), 'level', triggerBody()?['level']), 'progressionMarkersJson', coalesce(outputs('Row')?['ProgressionMarkersJson'], '')))))
     ```

**Do not enable full cloud restore for students while legacy cloud rows exist
without a `Revision`.** As written, this flow reports those rows as
`found:false`; a fresh device would not restore that legacy save. Before
student rollout, migrate each existing cloud row using a verified migration
procedure, preserving its original JSON in
`LegacyProgressionMarkersJson`, and test conversion/restore on a second device.
Do not treat an old row as an empty slot or let a first save overwrite it.

## Step 6 – Turn it on (GitHub)

Repository → Settings → Secrets and variables → Actions:

- **Secrets**: `WA_GGR_SAVE_PROGRESS_URL` = the new Step 4 trigger URL;
  `WA_GGR_GET_STUDENT_PROGRESS_URL` = the Step 5 trigger URL.
- **Variables**: `WA_GGR_SAVE_PROTOCOL_V2` = `true`,
  `WA_GGR_FULL_CLOUD_RESTORE` = `true`,
  `WA_GGR_PILOT_SHARED_KEY_PROGRESS` = `true`.

Then Actions → *Build and Deploy to GitHub Pages* → **Run workflow** on `main`.
Rollback: set the three variables to `false` and run the workflow again; local
saves are unaffected.

## Step 7 – Acceptance with the Demo account (outside class time)

1. Home computer: open Level 2, play one round. Cloud status should reach
   "synced". In `GGR_StudentProgress` the `NB5|HG-NB5-031|2` row shows
   `Revision` = 1, and the old Oct 28 JSON is now in
   `LegacyProgressionMarkersJson`.
2. Second computer (or a private browser window): log in as the Demo account
   and open Level 2. Round, cash, mines, machinery and strategy label match.
3. Play one round on the second computer (Revision 2). Back on the home
   computer reload Level 2: it adopts revision 2 and still shows all rounds
   locally (backup export contains the full history).
4. Without reloading the second computer, play a round there after step 3 on
   a third device: the stale device shows "cloud save conflict" and keeps its
   own progress; the List row is not overwritten.
5. Repeat for Level 3. Level 4 uploads after its first round is played.
6. Once the Demo passes, turn off the old `GGR_SaveProgress` flow.

### Multi-device rollout requirement

After the tenant flows are deployed and verified, there is **no designated
device**. A student or teacher can sign in on any authorized device; the game
must look up and restore the latest cloud save for that student's exact class,
student and level before continuing. Saving from one device must make the new
revision available to the next device.

Before enabling this for students, verify that every existing cloud row is
either migrated to the v2 revision/run contract or deliberately preserved and
handled through an approved recovery path. Also identify students whose latest
progress exists only in a browser's local storage; that progress has not
reached the cloud and needs a one-time upload from a device that still holds
it (or from its exported backup). This is a migration exception, not the
ongoing workflow.

If two devices are used offline or both continue from the same old revision,
the later save must be rejected as a conflict rather than silently overwrite
the other. The student must reload/reconcile the latest cloud save before
continuing on the stale device. Do not have the same student play the same
level concurrently on multiple devices.
