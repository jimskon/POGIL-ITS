-- Users table
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role ENUM('root', 'creator', 'instructor', 'student', 'grader') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Courses table
CREATE TABLE courses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    section VARCHAR(50) NOT NULL,
    semester ENUM('fall', 'spring', 'summer') NOT NULL,
    year INT NOT NULL,
    instructor_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (instructor_id) REFERENCES users(id)
);

-- Course enrollments
CREATE TABLE course_enrollments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT,
    student_id INT,
    UNIQUE(course_id, student_id),
    FOREIGN KEY (course_id) REFERENCES courses(id),
    FOREIGN KEY (student_id) REFERENCES users(id)
);

-- POGOL activities
CREATE TABLE pogol_activities (
    name VARCHAR(255) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    google_sheet_url TEXT NOT NULL,
    created_by INT,
    last_loaded TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Activity instances
CREATE TABLE activity_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_name VARCHAR(255),
    course_id INT,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    group_number INT,
    FOREIGN KEY (activity_name) REFERENCES pogol_activities(name),
    FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Activity groups
CREATE TABLE activity_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT,
    facilitator_name VARCHAR(255),
    facilitator_email VARCHAR(255),
    spokesperson_name VARCHAR(255),
    spokesperson_email VARCHAR(255),
    qc_name VARCHAR(255),
    qc_email VARCHAR(255),
    analyst_name VARCHAR(255),
    analyst_email VARCHAR(255),
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);

-- Group responses
CREATE TABLE responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT,
    question_id VARCHAR(255) NOT NULL,
    response_type ENUM('text', 'python', 'cpp') NOT NULL,
    response TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);

-- Feedback
CREATE TABLE feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT,
    feedback_text TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Followups
CREATE TABLE followups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT,
    followup_prompt TEXT NOT NULL,
    followup_generated TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (response_id) REFERENCES responses(id)
);

-- Event log
CREATE TABLE event_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    activity_instance_id INT,
    event_type VARCHAR(255) NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (activity_instance_id) REFERENCES activity_instances(id)
);