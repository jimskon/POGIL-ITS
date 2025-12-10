#!/bin/bash
# migrations/004_add_review_fields.sh
# Adds review_complete and reviewed_at columns to activity_instances table

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

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" <<'EOF'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS review_complete TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reviewed_at DATETIME NULL;
EOF

echo "✅ Migration complete: review_complete + reviewed_at added"
