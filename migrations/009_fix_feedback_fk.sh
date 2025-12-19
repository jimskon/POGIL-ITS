#!/usr/bin/env bash
set -euo pipefail

echo "🔧 Migration 009 — Fix feedback FK (responses_old -> responses)"

ENV_FILE="server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Can't find $ENV_FILE"
  exit 1
fi

# Load env (expects DB_HOST, DB_USER, DB_PASSWORD, DB_NAME; adjust names if yours differ)
set -a
source "$ENV_FILE"
set +a

: "${DB_HOST:?Missing DB_HOST in server/.env}"
: "${DB_USER:?Missing DB_USER in server/.env}"
: "${DB_PASSWORD:?Missing DB_PASSWORD in server/.env}"
: "${DB_NAME:?Missing DB_NAME in server/.env}"

MYSQL=(mysql -h"$DB_HOST" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" --protocol=tcp)

echo "📦 Backing up feedback table to feedback_bak_009 (if needed)..."
"${MYSQL[@]}" -e "CREATE TABLE IF NOT EXISTS feedback_bak_009 LIKE feedback;"
"${MYSQL[@]}" -e "INSERT IGNORE INTO feedback_bak_009 SELECT * FROM feedback;"
echo "✅ Backup complete"

echo "🔎 Dropping old FK and re-adding it to responses(id)..."
"${MYSQL[@]}" <<'SQL'
-- Find and drop the FK if it exists (common name feedback_ibfk_1)
-- If your FK name differs, update this line.
ALTER TABLE feedback DROP FOREIGN KEY feedback_ibfk_1;

-- (Optional but recommended) ensure response_id is indexed for FK perf
-- If it already exists, this will error; comment out if needed.
-- CREATE INDEX idx_feedback_response_id ON feedback(response_id);

ALTER TABLE feedback
  ADD CONSTRAINT feedback_ibfk_1
  FOREIGN KEY (response_id) REFERENCES responses(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;
SQL

echo "✅ Migration 009 complete"
