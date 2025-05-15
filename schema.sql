-- Users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role ENUM('root', 'creator', 'instructor', 'student', 'grader') NOT NULL DEFAULT 'student',
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY email (email),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- POGIL Classes
CREATE TABLE IF NOT EXISTS pogil_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  description TEXT,
  created_by INT,
  UNIQUE KEY name (name),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Courses (within a class)
CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  section TEXT NOT NULL,
  semester ENUM('fall', 'spring', 'summer') NOT NULL,
  year INT NOT NULL,
  instructor_id INT,
  class_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_course_key (code, section, semester, year),
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

-- Activities (metadata per class)
CREATE TABLE IF NOT EXISTS pogil_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  title TEXT NOT NULL,
  sheet_url TEXT,
  class_id INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_by INT,
  last_loaded TIMESTAMP,
  FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Activity Instances (per course)
CREATE TABLE IF NOT EXISTS activity_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT,
  course_id INT,
  group_number INT DEFAULT NULL,
  active_student_id INT DEFAULT NULL,
  start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status ENUM('in_progress', 'completed') DEFAULT 'in_progress',
  FOREIGN KEY (activity_id) REFERENCES pogil_activities(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Groups per instance
CREATE TABLE IF NOT EXISTS activity_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT,
  group_number INT NOT NULL DEFAULT 1,
  UNIQUE KEY unique_group_per_instance (activity_instance_id, group_number),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);

-- Group membership with roles
CREATE TABLE IF NOT EXISTS group_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_group_id INT NOT NULL,
  student_id INT NOT NULL,
  role ENUM('facilitator', 'spokesperson', 'analyst', 'qc') NOT NULL,
  UNIQUE KEY unique_member_role (activity_group_id, role),
  FOREIGN KEY (activity_group_id) REFERENCES activity_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Responses
CREATE TABLE IF NOT EXISTS responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT,
  question_id TEXT NOT NULL,
  response_type ENUM('text', 'python', 'cpp') NOT NULL DEFAULT 'text',
  response TEXT NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  group_id INT NOT NULL,
  answered_by_user_id INT NOT NULL,
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id),
  FOREIGN KEY (group_id) REFERENCES activity_groups(id),
  FOREIGN KEY (answered_by_user_id) REFERENCES users(id)
);

-- AI-generated feedback
CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  response_id INT,
  feedback_text TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- AI-generated follow-up questions
CREATE TABLE IF NOT EXISTS followups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  response_id INT,
  followup_prompt TEXT NOT NULL,
  followup_generated TEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Event logging
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

-- Heartbeat tracking for active participants
CREATE TABLE IF NOT EXISTS activity_heartbeats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_instance_id INT NOT NULL,
  user_id INT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_heartbeat (activity_instance_id, user_id),
  FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
