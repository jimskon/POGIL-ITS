// server/tests/makeDemoClass.js
// Create a demo creator/instructor, one class, one course, and a bunch of students.
// All accounts share the same password so you can easily log in as them.
//
// Run with: node server/tests/makeDemoClass.js

const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BASE_URL = 'http://localhost:4000/api';
const PASSWORD = 'KenyonTest777';   // Shared demo password

function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function getRandomName() {
  const first = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
    "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
    "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Margaret", "Donald", "Sandra",
    "Mark", "Ashley", "Paul", "Kimberly", "Steven", "Emily", "Andrew", "Donna", "Kenneth", "Michelle",
    "George", "Dorothy", "Joshua", "Carol", "Kevin", "Amanda", "Brian", "Melissa", "Edward", "Deborah"
  ];
  const last = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
    "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
    "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts"
  ];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// ----- helpers to hit admin/user endpoints -----

async function getUserByEmail(email) {
  const res = await axios.get(`${BASE_URL}/users/admin/users`);
  return res.data.find(u => u.email === email) || null;
}

async function pollForUser(email, { attempts = 10, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const u = await getUserByEmail(email);
    if (u) return u;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

async function ensureRole(user, desiredRole) {
  if (!user || !user.id) return user;
  if (user.role !== desiredRole) {
    console.log(`→ Updating role for ${user.email} from ${user.role} to ${desiredRole}`);
    await axios.put(`${BASE_URL}/users/admin/users/${user.id}/role`, { role: desiredRole });
    return { ...user, role: desiredRole };
  }
  return user;
}

async function registerUser(email, name, desiredRole) {
  try {
    console.log(`\n=== Registering ${desiredRole} ${email} ===`);
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      name, email, password: PASSWORD
    });
    const payload = res.data || {};

    if (payload && payload.id) {
      console.log(`✔ Registered user ${email} with id ${payload.id}`);
      return ensureRole(payload, desiredRole);
    }

    console.warn(`ℹ️ Register returned no user for ${email}. Polling admin list...`);
    let user = await pollForUser(email, { attempts: 12, delayMs: 500 });
    if (!user) {
      throw new Error(`User with email ${email} not found after registration.`);
    }
    return ensureRole(user, desiredRole);

  } catch (error) {
    if (error.response?.status === 409) {
      console.warn(`⚠️ Email already exists for ${email}. Fetching existing user.`);
      const existingUser = await pollForUser(email, { attempts: 1, delayMs: 0 });
      if (!existingUser) throw new Error(`Existing user ${email} not retrievable from admin list.`);
      return ensureRole(existingUser, desiredRole);
    }
    throw error;
  }
}

async function createClass(name, description, createdBy) {
  console.log(`\n=== Creating class "${name}" ===`);
  const res = await axios.post(`${BASE_URL}/classes`, { name, description, createdBy });
  console.log(`✔ Created class id ${res.data.id}`);
  return res.data;
}

async function createCourse(name, code, section, semester, year, instructorId, classId) {
  console.log(`\n=== Creating course "${name}" (${code}) ===`);
  const res = await axios.post(`${BASE_URL}/courses`, {
    name,
    code,
    section,
    semester,
    year,
    instructor_id: instructorId,
    class_id: classId
  });

  // If your API returns { id: ... } this will still work; otherwise id will be 'unknown'
  const courseId = res.data?.id ?? res.data?.courseId ?? 'unknown';

  console.log(`✔ Created course id ${courseId} with code ${code}`);
  return { ...res.data, id: courseId, code };
}


async function enrollStudent(courseCode, studentId) {
  console.log(`  → Enrolling student ${studentId} into ${courseCode}`);
  await axios.post(`${BASE_URL}/courses/enroll-by-code`, { code: courseCode, userId: studentId });
}

async function main() {
  try {
    console.log('=== Demo Class/Course/Student Generator ===');

    // 1) Creator/Instructor for the demo (no root)
    const creatorEmail = await prompt('\nCreator/Instructor email for demo (e.g., demo-instructor@example.com): ');
    const creatorName = await prompt('Display name for this creator/instructor [Demo Instructor]: ') || 'Demo Instructor';
    const creatorUser = await registerUser(creatorEmail.trim(), creatorName.trim(), 'creator');
    console.log(`Creator/instructor: ${creatorUser.name} (ID: ${creatorUser.id}, role: ${creatorUser.role})`);

    // 2) Class + Course info
    const className = await prompt('\nClass name (e.g., COMP118-Demo): ');
    const classDesc = await prompt('Class description [Demo class for coLearnAI]: ') || 'Demo class for coLearnAI';
    const demoClass = await createClass(className.trim(), classDesc.trim(), creatorUser.id);

    const courseName = await prompt('\nCourse name (e.g., Intro Programming Demo): ');
    const courseCodeRaw = await prompt('Course code (e.g., DEMO118): ');
    const section = await prompt('Section (e.g., 01): ');
    const semester = await prompt('Semester (e.g., spring): ');
    const yearStr = await prompt('Year (e.g., 2026): ');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();

    const courseCode = courseCodeRaw.trim();

    const demoCourse = await createCourse(
      courseName.trim(),
      courseCode,
      section.trim(),
      semester.trim().toLowerCase(),
      year,
      creatorUser.id,
      demoClass.id
    );


    // 3) Create demo students
    const studentTemplate = await prompt('\nStudent email template (e.g., demo-student@demo.local): ');
    const numStudentsStr = await prompt('Number of demo students to create (e.g., 6): ');
    const numStudents = parseInt(numStudentsStr, 10) || 4;

    const students = [];
    for (let i = 1; i <= numStudents; i++) {
      const email = studentTemplate.replace('@', `${i}@`); // demo-student1@..., demo-student2@...
      const student = await registerUser(email, getRandomName(), 'student');
      if (student) students.push(student);
    }

    // 4) Enroll all students into the demo course
    console.log(`\n=== Enrolling ${students.length} students into ${courseCode} ===`);
    for (const s of students) {
      await enrollStudent(courseCode, s.id);
    }


    console.log('\n🎉 Demo setup complete!');
    console.log('You can now log in as:');
    console.log(`  Creator/Instructor: ${creatorUser.email}  (password: ${PASSWORD})`);
    console.log('  Students:');
    for (const s of students) {
      console.log(`    ${s.email}  (password: ${PASSWORD})`);
    }
  } catch (error) {
    if (error.response) {
      console.error('\n❌ API Error:');
      console.error(`  URL:     ${error.config?.url}`);
      console.error(`  Method:  ${error.config?.method?.toUpperCase()}`);
      console.error(`  Status:  ${error.response.status} ${error.response.statusText}`);
      console.error(`  Message: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('\n❌ No response received from server:');
      console.error(error.request);
    } else {
      console.error('\n❌ Request setup/error:', error.message);
    }
  } finally {
    rl.close();
    console.log("\nAll demo accounts use password:", PASSWORD);
  }
}

main();
