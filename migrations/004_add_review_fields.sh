#!/bin/bash
# migrations/004_add_review_fields.sh
# Ensures submitted_at, graded_at, review_complete, and reviewed_at
# columns exist on activity_instances.

set -e

ENV_FILE="$(dirname "$0")/../server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ ERROR: server/.env not found"
  exit 1
fi

# Load DB credentials
export $(grep -v '^#' "$ENV_FILE" | xargs)

if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
  echo "❌ ERROR: Missing DB credentials in server/.env"
  exit 1
fi

echo "Running migration 004_add_review_fields..."
echo "--------------"
echo "ALTER TABLE activity_instances ..."
echo "--------------"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN IF NOT EXISTS graded_at DATETIME NULL AFTER submitted_at,
  ADD COLUMN IF NOT EXISTS review_complete TINYINT(1) NOT NULL DEFAULT 0 AFTER graded_at,
  ADD COLUMN IF NOT EXISTS reviewed_at DATETIME NULL AFTER review_complete;
EOF

echo "✅ Migration complete: submitted_at, graded_at, review_complete, reviewed_at ensured on activity_instances"
