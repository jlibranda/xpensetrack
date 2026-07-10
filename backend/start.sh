#!/bin/sh
# Disable Prisma's update notice / telemetry version check that can stall startup
export PRISMA_HIDE_UPDATE_MESSAGE=1
export CHECKPOINT_DISABLE=1

echo "→ Syncing database schema..."
# Use the LOCALLY installed prisma binary (never npx — npx may download a new major version at boot and hang)
# NOTE: no --accept-data-loss. Additive changes (new nullable columns) still apply; a
# DESTRUCTIVE change is refused instead of silently wiping data (e.g. stored proof files).
if [ -x ./node_modules/.bin/prisma ]; then
  ./node_modules/.bin/prisma db push --skip-generate || echo "⚠ schema sync skipped — a change would risk data loss. Apply it intentionally (see notes). Starting server anyway."
else
  echo "⚠ local prisma binary not found; skipping schema sync"
fi

echo "→ Starting server..."
exec node src/index.js
