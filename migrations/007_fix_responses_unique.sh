#!/usr/bin/env bash
set -euo pipefail

# 007_fix_responses_unique.sh
# Idempotent migration:
#  - dedupe responses rows on (activity_instance_id, question_id, response_type, answered_by_user_id)
#  - add unique index to enforce that constraint

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$(cd "$SCRIPT_DIR/.." && pwd)/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ .env not found at: $ENV_FILE"
  exit 1
fi

# Load .env safely (supports quoted values, ignores comments/blank lines)
set -a
# shellcheck disable=SC1090
source <(
  sed -nE \
    -e 's/\r$//' \
    -e 's/^[[:space:]]+//; s/[[:space:]]+$//' \
    -e '/^#/d; /^$/d' \
    -e 's/^export[[:space:]]+//g' \
    -e 's/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/\1=\2/p' \
    "$ENV_FILE"
)
set +a

# Support common env var names
DB_HOST="${DB_HOST:-${MYSQL_HOST:-${MARIADB_HOST:-localhost}}}"
DB_PORT="${DB_PORT:-${MYSQL_PORT:-${MARIADB_PORT:-3306}}}"
DB_USER="${DB_USER:-${MYSQL_USER:-${MARIADB_USER:-root}}}"
DB_PASSWORD="${DB_PASSWORD:-${MYSQL_PASSWORD:-${MARIADB_PASSWORD:-}}}"
DB_NAME="${DB_NAME:-${MYSQL_DATABASE:-${MARIADB_DATABASE:-}}}"

if [[ -z "${DB_NAME}" ]]; then
  echo "❌ DB_NAME (or MYSQL_DATABASE) not set in .env"
  exit 1
fi

MYSQL_BIN="${MYSQL_BIN:-mysql}"

# If password empty, avoid -p
PASS_ARG=()
if [[ -n "${DB_PASSWORD}" ]]; then
  PASS_ARG=(-p"${DB_PASSWORD}")
fi

MYSQL=( "$MYSQL_BIN" -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" "${PASS_ARG[@]}" "${DB_NAME}" --protocol=tcp --batch --raw --silent )

echo "➡️  [007] Connecting to ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# Name your unique index deterministically
UNIQ_NAME="uniq_responses_instance_qid_type_user"

# Check if the unique index already exists
IDX_EXISTS="$("${MYSQL[@]}" -e "
SELECT COUNT(*) AS c
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'responses'
  AND index_name = '${UNIQ_NAME}';
")"

if [[ "${IDX_EXISTS}" != "0" ]]; then
  echo "✅ [007] Unique index ${UNIQ_NAME} already exists. Ensuring no duplicates remain..."
else
  echo "ℹ️  [007] Unique index ${UNIQ_NAME} not found. Will dedupe then add it..."
fi

# Dedupe (idempotent): keep the newest row by id for each key
# NULL-safe compare for answered_by_user_id using <=>.
echo "🧹 [007] Deleting duplicates (keeping newest by id)..."
"${MYSQL[@]}" <<'SQL'
START TRANSACTION;

-- Delete duplicates where keys match and r is older than r2 (smaller id)
DELETE r
FROM responses r
JOIN responses r2
  ON r.activity_instance_id = r2.activity_instance_id
 AND r.question_id          = r2.question_id
 AND r.response_type        = r2.response_type
 AND (r.answered_by_user_id <=> r2.answered_by_user_id)
 AND r.id < r2.id;

COMMIT;
SQL

# Add unique index if missing (idempotent)
if [[ "${IDX_EXISTS}" == "0" ]]; then
  echo "🔒 [007] Adding unique index ${UNIQ_NAME}..."
  "${MYSQL[@]}" <<SQL
ALTER TABLE responses
  ADD UNIQUE KEY ${UNIQ_NAME} (activity_instance_id, question_id, response_type, answered_by_user_id);
SQL
  echo "✅ [007] Unique index added."
else
  echo "✅ [007] Unique index already present; skipping ALTER."
fi

echo "✅ [007] Done."
