-- Users table: supports roles (root, creator, instructor, student, grader)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role ENUM('root', 'creator', 'instructor', 'student', 'grader') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Course table
CREATE TABLE IF NOT EXISTS courses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    section TEXT NOT NULL,
    semester ENUM ('fall', 'spring', 'summer') NOT NULL,
    year INT NOT NULL,
    instructor_id INT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Course enrollment
CREATE TABLE IF NOT EXISTS course_enrollments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT REFERENCES courses(id),
    student_id INT REFERENCES users(id),
    UNIQUE(course_id, student_id)
);

-- Activity metadata
CREATE TABLE IF NOT EXISTS pogol_activities (
    name VARCHAR(191)  PRIMARY KEY, -- Unique activity ID matching \name{...}
    title TEXT NOT NULL,
    google_sheet_url TEXT NOT NULL,
    created_by INT REFERENCES users(id),
    last_loaded TIMESTAMP
);

-- Group instance of a POGOL activity
CREATE TABLE IF NOT EXISTS activity_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_name VARCHAR(191),
    course_id INT,
    start_time TIMESTAMP,
    group_number INT,
    FOREIGN KEY (activity_name) REFERENCES pogol_activities(name),
    FOREIGN KEY (course_id) REFERENCES courses(id)
);

-- Group roles per activity instance
CREATE TABLE IF NOT EXISTS activity_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT REFERENCES activity_instances(id),
    facilitator_name TEXT NOT NULL,
    facilitator_email TEXT NOT NULL,
    spokesperson_name TEXT NOT NULL,
    spokesperson_email TEXT NOT NULL,
    qc_name TEXT,
    qc_email TEXT,
    analyst_name TEXT,
    analyst_email TEXT
);

-- Group responses (not tied to specific student)
CREATE TABLE IF NOT EXISTS responses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activity_instance_id INT REFERENCES activity_instances(id),
    question_id TEXT NOT NULL,
    response_type ENUM('text', 'python', 'cpp') NOT NULL,
    response TEXT NOT NULL,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI-generated feedback
CREATE TABLE IF NOT EXISTS feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT REFERENCES responses(id),
    feedback_text TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI-generated follow-ups
CREATE TABLE IF NOT EXISTS followups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    response_id INT REFERENCES responses(id),
    followup_prompt TEXT NOT NULL,
    followup_generated TEXT NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Event logging
CREATE TABLE IF NOT EXISTS event_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT REFERENCES users(id),
    activity_instance_id INT REFERENCES activity_instances(id),
    event_type TEXT NOT NULL,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
