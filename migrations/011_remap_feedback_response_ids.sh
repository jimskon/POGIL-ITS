#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Migration 011 — Remap feedback.response_id (responses_old -> responses) + fix FK"

ENV_FILE="server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Can't find $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

: "${DB_HOST:?Missing DB_HOST in server/.env}"
: "${DB_USER:?Missing DB_USER in server/.env}"
: "${DB_PASSWORD:?Missing DB_PASSWORD in server/.env}"
: "${DB_NAME:?Missing DB_NAME in server/.env}"

MYSQL=(mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" --protocol=tcp)

echo "🔌 host=$DB_HOST db=$DB_NAME user=$DB_USER"

echo "📦 Backing up feedback -> feedback_bak_011 (if needed)..."
"${MYSQL[@]}" -e "CREATE TABLE IF NOT EXISTS feedback_bak_011 LIKE feedback;"
"${MYSQL[@]}" -e "INSERT IGNORE INTO feedback_bak_011 SELECT * FROM feedback;"
echo "✅ Backup complete"

echo "🔎 Verifying responses_old exists..."
"${MYSQL[@]}" -e "SHOW TABLES LIKE 'responses_old';" | grep -q "responses_old" || {
  echo "❌ responses_old not found. Aborting (this migration expects it)."
  exit 1
}
echo "✅ responses_old exists"

echo "📌 Orphans BEFORE:"
"${MYSQL[@]}" -e "
SELECT COUNT(*) AS orphan_feedback_rows
FROM feedback f
LEFT JOIN responses r ON r.id = f.response_id
WHERE r.id IS NULL;
"

echo "🔁 Remapping feedback.response_id using (activity_instance_id, question_id)..."
"${MYSQL[@]}" <<'SQL'
START TRANSACTION;

-- Map feedback.response_id (old responses_old.id) -> responses.id
UPDATE feedback f
JOIN responses_old ro ON ro.id = f.response_id
JOIN responses r
  ON r.activity_instance_id = ro.activity_instance_id
 AND r.question_id = ro.question_id
SET f.response_id = r.id;

COMMIT;
SQL
echo "✅ Remap complete"

echo "📌 Orphans AFTER remap:"
"${MYSQL[@]}" -e "
SELECT COUNT(*) AS orphan_feedback_rows
FROM feedback f
LEFT JOIN responses r ON r.id = f.response_id
WHERE r.id IS NULL;
"

echo "🧹 Deleting any remaining orphan feedback rows (should be small/zero)..."
"${MYSQL[@]}" -e "
DELETE f
FROM feedback f
LEFT JOIN responses r ON r.id = f.response_id
WHERE r.id IS NULL;
"
echo "✅ Orphan delete complete"

echo "📌 Orphans FINAL:"
"${MYSQL[@]}" -e "
SELECT COUNT(*) AS orphan_feedback_rows
FROM feedback f
LEFT JOIN responses r ON r.id = f.response_id
WHERE r.id IS NULL;
"

echo "🧨 Dropping any FK on feedback.response_id that references responses_old (if present)..."
FK_NAME="$("${MYSQL[@]}" -N -B -e "
SELECT CONSTRAINT_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'feedback'
  AND COLUMN_NAME = 'response_id'
  AND REFERENCED_TABLE_NAME = 'responses_old'
LIMIT 1;
")"

if [[ -n "$FK_NAME" ]]; then
  echo "✅ Found FK referencing responses_old: $FK_NAME — dropping it..."
  "${MYSQL[@]}" -e "ALTER TABLE feedback DROP FOREIGN KEY \`$FK_NAME\`;"
else
  echo "✅ No FK referencing responses_old found."
fi

echo "➕ Ensuring correct FK exists: feedback.response_id -> responses.id"

# Drop our desired FK name if it already exists (avoid duplicate-name errors)
EXISTING_NEW="$("${MYSQL[@]}" -N -B -e "
SELECT CONSTRAINT_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'feedback'
  AND COLUMN_NAME = 'response_id'
  AND REFERENCED_TABLE_NAME = 'responses'
LIMIT 1;
")"

if [[ -n "$EXISTING_NEW" ]]; then
  echo "✅ FK already exists referencing responses: $EXISTING_NEW (leaving it in place)"
else
  "${MYSQL[@]}" -e "
ALTER TABLE feedback
  ADD CONSTRAINT feedback_fk_response
  FOREIGN KEY (response_id) REFERENCES responses(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
"
  echo "✅ Added FK feedback_fk_response"
fi

echo "✅ Migration 011 complete"
