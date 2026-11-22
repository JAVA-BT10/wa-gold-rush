# Large cloud saves (superseded)

The document-library design previously described here was **not adopted**.
The owner chose Option C: cloud saves are compact resume saves (current state,
cumulative `strategyMetrics` and `roundMetrics`, investment profile,
checkpoint and approval evidence, and the last 20 rounds) stored in the
existing `ProgressionMarkersJson` column. Local saves and exported backups keep
the complete round history.

Measured on the owner's Demo backups: Level 2 (1,148 rounds) uploads 14,667
characters and Level 3 (2,306 rounds) uploads 22,267, against a List limit of
63,999. The client refuses to upload anything over 60,000 characters and keeps
it local.

Follow `option-c-cloud-save-build-guide.md` for the List, column and flow work.
