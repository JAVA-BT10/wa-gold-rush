#!/usr/bin/env bash
set -euo pipefail

BRANCH="main"
TARGET_AWST="2026-07-23 16:00:00 +0800"
BACKUP_BRANCH="backup-before-awst-restore-$(date +%Y%m%d-%H%M%S)"

git fetch origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

git checkout -b "$BACKUP_BRANCH"
git push -u origin "$BACKUP_BRANCH"

git checkout "$BRANCH"

TARGET_SHA=$(git rev-list -n 1 --before="$TARGET_AWST" "origin/$BRANCH")

if [ -z "$TARGET_SHA" ]; then
  echo "No commit found before $TARGET_AWST. Aborting."
  exit 1
fi

echo "Target commit selected:"
git show -s --format='%H %ci %s' "$TARGET_SHA"

echo
echo "About to force-update $BRANCH to $TARGET_SHA"
read -r -p "Type YES to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

git reset --hard "$TARGET_SHA"
git push --force-with-lease origin "$BRANCH"

echo "Done. $BRANCH restored to $TARGET_SHA"
echo "Backup branch: $BACKUP_BRANCH"
