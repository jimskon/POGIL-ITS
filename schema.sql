-- Users table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role ENUM('root', 'creator', 'instructor', 'student', 'grader') NOT NULL DEFAULT 'student',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Classes Table
CREATE TABLE IF NOT EXISTS pogil_classes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) UNIQUE NOT NULL,
    description TEXT,
    created_by INT,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Courses table
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
    FOREIGN KEY (instructor_id) REFERENCES users(id),
    FOREIGN KEY (class_id) REFERENCES pogil_classes(id) ON DELETE SET NULL,
    UNIQUE KEY unique_course_key (code, section, semester, year)
);

-- Course enrollments
CREATE TABLE IF NOT EXISTS course_enrollments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT,
    student_id INT,
    UNIQUE(course_id, student_id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (student_id) REFERENCES users(id)
);

-- POGIL activity metadata
CREATE TABLE IF NOT EXISTS pogil_activities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(191) NOT NULL,
    title TEXT NOT NULL,
    sheet_url TEXT,
    class_id INT NOT NULL,
    order_index INT NOT NULL DEFAULT 0,
    created_by INT,
    last_loaded TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES pogil_classes(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Activity Instances Table
CREATE TABLE IF NOT EXISTS activity_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_id INT,
    course_id INT,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('in_progress', 'completed') DEFAULT 'in_progress',
    FOREIGN KEY (activity_id) REFERENCES pogil_activities(id),
    FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Activity Groups (1 per group, multiple per instance)
CREATE TABLE IF NOT EXISTS activity_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT NOT NULL,
    group_number INT NOT NULL,
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id),
    UNIQUE(activity_instance_id, group_number)
);

-- Group Members and Roles (one row per student)
CREATE TABLE IF NOT EXISTS group_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id INT NOT NULL,
    student_id INT NOT NULL,
    role ENUM('facilitator', 'spokesperson', 'analyst', 'qc') NOT NULL,
    FOREIGN KEY (group_id) REFERENCES activity_groups(id),
    FOREIGN KEY (student_id) REFERENCES users(id)
);

-- Group responses
CREATE TABLE IF NOT EXISTS responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT,
    question_id TEXT NOT NULL,
    response_type ENUM('text', 'python', 'cpp') NOT NULL,
    response TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);

-- AI-generated feedback
CREATE TABLE IF NOT EXISTS feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT,
    feedback_text TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- AI-generated follow-ups
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
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);
