#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Migration 008 — Fix responses uniqueness + bad question_ids"

# ------------------------------------------------------------
# Load DB credentials from server/.env
# ------------------------------------------------------------
ENV_FILE="$(dirname "$0")/../server/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ server/.env not found at $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${DB_HOST:?Missing DB_HOST}"
: "${DB_USER:?Missing DB_USER}"
: "${DB_PASSWORD:?Missing DB_PASSWORD}"
: "${DB_NAME:?Missing DB_NAME}"

MYSQL="mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME"

# ------------------------------------------------------------
# Backup responses table (idempotent)
# ------------------------------------------------------------
BACKUP_TABLE="responses_bak_008"

echo "📦 Backing up responses table to $BACKUP_TABLE (if needed)..."

$MYSQL <<EOF
CREATE TABLE IF NOT EXISTS $BACKUP_TABLE LIKE responses;
INSERT IGNORE INTO $BACKUP_TABLE SELECT * FROM responses;
EOF

echo "✅ Backup complete"

# ------------------------------------------------------------
# Deduplicate responses
# ------------------------------------------------------------
echo "🧹 Deduplicating responses..."

$MYSQL <<'EOF'
DELETE r
FROM responses r
JOIN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY activity_instance_id, question_id
        ORDER BY
          COALESCE(updated_at, submitted_at) DESC,
          submitted_at DESC,
          id DESC
      ) AS rn
    FROM responses
  ) t
  WHERE rn > 1
) d ON d.id = r.id;
EOF

echo "✅ Deduplication complete"

# ------------------------------------------------------------
# Fix question_id type (safe / idempotent)
# ------------------------------------------------------------
echo "🔤 Ensuring question_id is VARCHAR(255)..."

$MYSQL <<'EOF'
ALTER TABLE responses
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE responses
  MODIFY question_id VARCHAR(255) NOT NULL;
EOF

# ------------------------------------------------------------
# Add unique constraint if missing
# ------------------------------------------------------------
echo "🔐 Ensuring unique key exists..."

$MYSQL <<'EOF'
SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'responses'
    AND index_name = 'uq_responses_instance_question'
);

SET @sql := IF(
  @idx = 0,
  'ALTER TABLE responses ADD UNIQUE KEY uq_responses_instance_question (activity_instance_id, question_id)',
  'SELECT "Unique key already exists"'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
EOF

echo "✅ Unique constraint verified"

# ------------------------------------------------------------
# Final sanity check
# ------------------------------------------------------------
echo "🔍 Checking for remaining duplicates..."

$MYSQL <<'EOF'
SELECT COUNT(*) AS remaining_duplicates
FROM (
  SELECT activity_instance_id, question_id
  FROM responses
  GROUP BY activity_instance_id, question_id
  HAVING COUNT(*) > 1
) t;
EOF

echo "🎉 Migration 008 completed successfully"
