-- Use the right DB
USE pogil_db;

-- ===== BACKUP FIRST =====
-- Creates a snapshot table. (Note: this copies ALL rows and can be large.)
SET @bak := CONCAT('responses_bak_', DATE_FORMAT(NOW(), '%Y%m%d_%H%i%S'));

SET @sql := CONCAT('CREATE TABLE ', @bak, ' AS SELECT * FROM responses;');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ===== MIGRATE KEYS =====
-- Old mapping from ASCII after 'z':
-- '{' -> aa
-- '|' -> ab
-- '}' -> ac
-- '~' -> ad

-- Helper: update rows whose question_id starts with digits + "{"
UPDATE responses
SET question_id = CONCAT(
  REGEXP_SUBSTR(question_id, '^[0-9]+'),
  'aa',
  SUBSTRING(question_id, LENGTH(REGEXP_SUBSTR(question_id, '^[0-9]+')) + 2)
)
WHERE question_id REGEXP '^[0-9]+\\{';

UPDATE responses
SET question_id = CONCAT(
  REGEXP_SUBSTR(question_id, '^[0-9]+'),
  'ab',
  SUBSTRING(question_id, LENGTH(REGEXP_SUBSTR(question_id, '^[0-9]+')) + 2)
)
WHERE question_id REGEXP '^[0-9]+\\|';

UPDATE responses
SET question_id = CONCAT(
  REGEXP_SUBSTR(question_id, '^[0-9]+'),
  'ac',
  SUBSTRING(question_id, LENGTH(REGEXP_SUBSTR(question_id, '^[0-9]+')) + 2)
)
WHERE question_id REGEXP '^[0-9]+\\}';

UPDATE responses
SET question_id = CONCAT(
  REGEXP_SUBSTR(question_id, '^[0-9]+'),
  'ad',
  SUBSTRING(question_id, LENGTH(REGEXP_SUBSTR(question_id, '^[0-9]+')) + 2)
)
WHERE question_id REGEXP '^[0-9]+~';
