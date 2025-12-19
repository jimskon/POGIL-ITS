#!/usr/bin/env bash
# migrations/20251210_add_progress_cache_and_refresh_schema.sh
#
# 1. Adds cached progress/test columns to activity_instances.
# 2. Regenerates schema.sql from the live database schema.
#
# Assumes DB_* vars are in server/.env:
#   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

set -euo pipefail

# --- locate project root and env/schema paths ---

cd "$(dirname "$0")/.."   # go to project root

ENV_FILE="server/.env"
SCHEMA_FILE="schema.sql"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Could not find $ENV_FILE"
  exit 1
fi

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "WARNING: $SCHEMA_FILE does not exist yet; it will be created."
fi

# --- load DB credentials from .env ---

# This is a simple parser: it grabs only the DB_* lines.
# Note: if your password has spaces or weird shell chars, you may need to quote it in .env.
export $(grep -E '^(DB_HOST|DB_PORT|DB_USER|DB_PASSWORD|DB_NAME)=' "$ENV_FILE" | xargs)

: "${DB_HOST:?DB_HOST not set in server/.env}"
: "${DB_USER:?DB_USER not set in server/.env}"
: "${DB_PASSWORD:?DB_PASSWORD not set in server/.env}"
: "${DB_NAME:?DB_NAME not set in server/.env}"
DB_PORT="${DB_PORT:-3306}"

echo "Using database ${DB_NAME} at ${DB_HOST}:${DB_PORT} ..."

MYSQL_CMD=(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" "$DB_NAME")
MYSQLDUMP_CMD=(mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "-p${DB_PASSWORD}" --no-data --skip-comments "$DB_NAME")

# --- step 1: run the migration on activity_instances ---

echo "Running migration on activity_instances ..."

"${MYSQL_CMD[@]}" <<'SQL'
ALTER TABLE activity_instances
  ADD COLUMN IF NOT EXISTS is_test TINYINT(1) NOT NULL DEFAULT 0 AFTER activity_id,
  ADD COLUMN IF NOT EXISTS total_groups INT NULL AFTER is_test,
  ADD COLUMN IF NOT EXISTS completed_groups INT NOT NULL DEFAULT 0 AFTER total_groups,
  ADD COLUMN IF NOT EXISTS progress_status ENUM('not_started','in_progress','completed')
    NOT NULL DEFAULT 'not_started'
    AFTER completed_groups,
  ADD COLUMN IF NOT EXISTS points_earned INT NULL AFTER progress_status,
  ADD COLUMN IF NOT EXISTS points_possible INT NULL AFTER points_earned;

ALTER TABLE activity_instances
  ADD INDEX IF NOT EXISTS idx_ai_course_activity_test (course_id, activity_id, is_test),
  ADD INDEX IF NOT EXISTS idx_ai_progress_status (progress_status);
SQL

echo "Migration completed."

# --- step 2: regenerate schema.sql from live DB ---

echo "Regenerating schema.sql from live database schema ..."

TMP_DUMP="$(mktemp)"
TMP_HEADER="$(mktemp)"
TMP_COMBINED="$(mktemp)"

# 2a. Capture current header from existing schema.sql (everything before the first CREATE TABLE)
if [ -f "$SCHEMA_FILE" ]; then
  FIRST_CREATE_LINE=$(grep -n '^CREATE TABLE' "$SCHEMA_FILE" | head -n1 | cut -d: -f1 || true)
  if [ -n "${FIRST_CREATE_LINE:-}" ]; then
    # Grab everything up to the line *before* the first CREATE TABLE
    HEADER_END=$((FIRST_CREATE_LINE - 1))
    if [ "$HEADER_END" -gt 0 ]; then
      head -n "$HEADER_END" "$SCHEMA_FILE" > "$TMP_HEADER"
    fi
  else
    # No CREATE TABLE found, keep whole file as header
    cat "$SCHEMA_FILE" > "$TMP_HEADER"
  fi
else
  # No existing schema.sql; we just create an empty header
  : > "$TMP_HEADER"
fi

# 2b. Dump current schema (no data, no mysqldump comment header)
"${MYSQLDUMP_CMD[@]}" > "$TMP_DUMP"

# 2c. Ensure CREATE TABLE IF NOT EXISTS instead of plain CREATE TABLE
#     (mysqldump uses: CREATE TABLE `table_name` ( ... );
sed -E 's/^CREATE TABLE /CREATE TABLE IF NOT EXISTS /' "$TMP_DUMP" > "$TMP_COMBINED"

# 2d. Combine preserved header + new dump into schema.sql
{
  cat "$TMP_HEADER"
  # Make sure there's a separating blank line if header exists and doesn’t already end with one
  echo
  cat "$TMP_COMBINED"
} > "$SCHEMA_FILE"

rm -f "$TMP_DUMP" "$TMP_HEADER" "$TMP_COMBINED"

echo "schema.sql has been refreshed."

echo "All done."
