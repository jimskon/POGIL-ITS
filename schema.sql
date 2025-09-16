
-- ============================================
-- POGIL-ITS Cleaned Database Schema (v2025)
-- One activity_instance per group model
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role ENUM('root','creator','instructor','student','grader') NOT NULL DEFAULT 'student',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- POGIL Classes
CREATE TABLE IF NOT EXISTS pogil_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE,
  description TEXT,
  created_by INT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Courses
CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  section TEXT NOT NULL,
  semester ENUM('fall','spring','summer') NOT NULL,
  year INT NOT NULL,
  instructor_id INT,
  class_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_course (code(255), section(255), semester, year),
  FOREIGN KEY (instructor_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE SET NULL
);

-- Enrollments
CREATE TABLE IF NOT EXISTS course_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  student_id INT NOT NULL,
  UNIQUE(course_id, student_id),
  FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Activities
CREATE TABLE IF NOT EXISTS pogil_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  title TEXT NOT NULL,
  sheet_url TEXT,
  class_id INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_by INT,
  last_loaded TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Activity Instances
CREATE TABLE IF NOT EXISTS activity_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  course_id INT NOT NULL,
  status ENUM('in_progress','completed') DEFAULT 'in_progress',
  active_student_id INT DEFAULT NULL,
  group_number INT,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_groups INT DEFAULT NULL,
  FOREIGN KEY (activity_id) REFERENCES pogil_activities(id),
  FOREIGN KEY (course_id) REFERENCES courses(id),
  FOREIGN KEY (active_student_id) REFERENCES users(id)
);

-- Group membership with roles, linked to activity_instances
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  student_id INT NOT NULL,
  role ENUM('facilitator', 'spokesperson', 'analyst', 'qc') NOT NULL,
  connected BOOLEAN DEFAULT FALSE,
  last_heartbeat DATETIME DEFAULT NULL,
  UNIQUE KEY unique_member_role (activity_instance_id, role),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

--- Responses

Create Table: CREATE TABLE `responses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `activity_instance_id` int(11) NOT NULL,
  `question_id` text NOT NULL,
  `response_type` enum('text','python','cpp') NOT NULL DEFAULT 'text',
  `response` text NOT NULL,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `answered_by_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `activity_instance_id` (`activity_instance_id`),
  KEY `answered_by_user_id` (`answered_by_user_id`),
  CONSTRAINT `responses_ibfk_1` FOREIGN KEY (`activity_instance_id`) REFERENCES `activity_instances` (`id`) ON DELETE CASCADE,
  CONSTRAINT `responses_ibfk_2` FOREIGN KEY (`answered_by_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=3539544 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

  -- Foreign Keys
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (answered_by_user_id) REFERENCES users(id) ON DELETE CASCADE,

  -- Enforce uniqueness of response per user/question/type
  UNIQUE KEY unique_response (
    activity_instance_id,
    question_id
  )
);



-- AI Feedback
Create Table: CREATE TABLE `feedback` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `response_id` int(11) DEFAULT NULL,
  `feedback_text` text NOT NULL,
  `generated_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `feedback_ibfk_1` (`response_id`),
  CONSTRAINT `feedback_ibfk_1` FOREIGN KEY (`response_id`) REFERENCES `responses` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=1435 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci

-- AI Follow-ups
CREATE TABLE IF NOT EXISTS followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  response_id INT,
  followup_prompt TEXT NOT NULL,
  followup_generated TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Activity Heartbeats
CREATE TABLE IF NOT EXISTS activity_heartbeats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  user_id INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_heartbeat (activity_instance_id, user_id),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Event Log
CREATE TABLE IF NOT EXISTS event_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  activity_instance_id INT,
  event_type TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pending_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255),
  code VARCHAR(6),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
