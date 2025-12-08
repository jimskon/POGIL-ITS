-- ============================================
-- POGIL-ITS Cleaned Database Schema (v2025)
-- One activity_instance per group model
-- ============================================

-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role ENUM('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- POGIL Classes
CREATE TABLE IF NOT EXISTS pogil_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  description TEXT,
  created_by INT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  code VARCHAR(191) NOT NULL,
  section VARCHAR(191) NOT NULL,
  semester ENUM('fall','spring','summer') NOT NULL,
  year INT NOT NULL,
  instructor_id INT NULL,
  class_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_course (code, section, semester, year),
  FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Enrollments
CREATE TABLE IF NOT EXISTS course_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  student_id INT NOT NULL,
  UNIQUE KEY uniq_course_student (course_id, student_id),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pogil_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Activity metadata
  name VARCHAR(191) NOT NULL,
  title TEXT NOT NULL,

  -- Google Doc / Sheet reference
  sheet_url TEXT,

  -- Parent class
  class_id INT NOT NULL,

  -- Logical ordering within the class
  order_index INT NOT NULL DEFAULT 0,

  -- Creator user (nullable)
  created_by INT NULL,

  -- Tracks last time the document was fetched/parsed
  last_loaded TIMESTAMP NULL DEFAULT NULL,

  -- NEW: indicates whether the activity is a test/assessment
  is_test TINYINT(1) NOT NULL DEFAULT 0,

  -- FKs
  FOREIGN KEY (class_id)
    REFERENCES pogil_classes(id)
    ON DELETE CASCADE,

  FOREIGN KEY (created_by)
    REFERENCES users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Activity Instances (one per group)
CREATE TABLE IF NOT EXISTS activity_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  course_id INT NOT NULL,

  status ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',

  active_student_id INT DEFAULT NULL,
  group_number INT,
  start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_groups INT DEFAULT NULL,

  -- NEW: timed-test fields
  test_start_at DATETIME DEFAULT NULL COMMENT 'Scheduled start time for timed tests',
  test_duration_minutes INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Time limit in minutes (0 = no limit)',
  test_reopen_until DATETIME DEFAULT NULL COMMENT 'Optional reopen-until time for this instance',

  -- Optional but very useful for both tests and regular activities
  submitted_at DATETIME DEFAULT NULL COMMENT 'Timestamp when the instance was finally submitted',

  FOREIGN KEY (activity_id) REFERENCES pogil_activities(id) ON DELETE CASCADE,
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (active_student_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;

-- Group membership with roles
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  student_id INT NOT NULL,
  role ENUM('facilitator','spokesperson','analyst','qc') DEFAULT NULL,
  connected BOOLEAN DEFAULT FALSE,
  last_heartbeat DATETIME DEFAULT NULL,
  UNIQUE KEY unique_member_role (activity_instance_id, role),
  KEY idx_gm_instance_student (activity_instance_id, student_id),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Responses
CREATE TABLE IF NOT EXISTS responses (
  id INT NOT NULL AUTO_INCREMENT,
  activity_instance_id INT NOT NULL,
  question_id VARCHAR(64) NOT NULL,                         -- indexable; TEXT would need a prefix
  response_type ENUM('text','code','file','followup','state','python','cpp') NOT NULL DEFAULT 'text',
  response MEDIUMTEXT NULL,
  submitted_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  answered_by_user_id INT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ai_qid (activity_instance_id, question_id),
  KEY idx_answered_by (answered_by_user_id),
  CONSTRAINT fk_responses_ai FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  CONSTRAINT fk_responses_user FOREIGN KEY (answered_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_response (activity_instance_id, question_id)  -- one response per question per instance
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Feedback (generated comments on a specific response)
CREATE TABLE IF NOT EXISTS feedback (
  id INT NOT NULL AUTO_INCREMENT,
  response_id INT DEFAULT NULL,
  feedback_text TEXT NOT NULL,
  generated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_feedback_response (response_id),
  CONSTRAINT fk_feedback_response FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AI Follow-ups (prompt + generated followup text tied to a response)
CREATE TABLE IF NOT EXISTS followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  response_id INT,
  followup_prompt TEXT NOT NULL,
  followup_generated TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity Heartbeats
CREATE TABLE IF NOT EXISTS activity_heartbeats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  user_id INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_heartbeat (activity_instance_id, user_id),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Event Log
CREATE TABLE IF NOT EXISTS event_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  activity_instance_id INT,
  event_type VARCHAR(191) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pending Users (invite/verification flow)
CREATE TABLE IF NOT EXISTS pending_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  code VARCHAR(6),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
