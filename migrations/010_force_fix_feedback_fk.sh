#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Migration 010 — Force-fix feedback FK (responses_old -> responses)"

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

MYSQL=(mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" --protocol=tcp -N -B)

echo "🔌 host=$DB_HOST db=$DB_NAME user=$DB_USER"

echo "📌 Before:"
"${MYSQL[@]}" <<'SQL'
SELECT DATABASE() AS db;
SELECT
  CONSTRAINT_NAME,
  REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME='feedback'
  AND COLUMN_NAME='response_id'
  AND REFERENCED_TABLE_NAME IS NOT NULL;
SQL

echo "🧨 Dropping any FK on feedback.response_id that references responses_old..."
FK_NAMES=$("${MYSQL[@]}" <<'SQL'
SELECT CONSTRAINT_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME='feedback'
  AND COLUMN_NAME='response_id'
  AND REFERENCED_TABLE_NAME='responses_old';
SQL
)

if [[ -n "${FK_NAMES// }" ]]; then
  while IFS= read -r fk; do
    [[ -z "$fk" ]] && continue
    echo "   - DROP FOREIGN KEY \`$fk\`"
    "${MYSQL[@]}" -e "ALTER TABLE feedback DROP FOREIGN KEY \`$fk\`;"
  done <<< "$FK_NAMES"
else
  echo "✅ No FK referencing responses_old found."
fi

echo "➕ Ensuring correct FK exists: feedback.response_id -> responses.id"

# If a FK already exists (to responses), adding will error; so check first.
EXISTS_TO_RESPONSES=$("${MYSQL[@]}" <<'SQL'
SELECT COUNT(*)
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME='feedback'
  AND COLUMN_NAME='response_id'
  AND REFERENCED_TABLE_NAME='responses';
SQL
)

if [[ "$EXISTS_TO_RESPONSES" -eq 0 ]]; then
  "${MYSQL[@]}" <<'SQL'
ALTER TABLE feedback
  ADD CONSTRAINT feedback_fk_response
  FOREIGN KEY (response_id) REFERENCES responses(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
SQL
  echo "✅ Added FK feedback_fk_response"
else
  echo "✅ FK to responses already present"
fi

echo "📌 After:"
"${MYSQL[@]}" <<'SQL'
SELECT
  CONSTRAINT_NAME,
  REFERENCED_TABLE_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME='feedback'
  AND COLUMN_NAME='response_id'
  AND REFERENCED_TABLE_NAME IS NOT NULL;

SHOW CREATE TABLE feedback;
SQL

echo "✅ Migration 010 complete"
