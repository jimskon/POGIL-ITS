const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const BASE_URL = 'http://localhost:4000/api';
const PASSWORD = 'pinhead';

function getRandomName() {
  const firstNames = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
    "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
    "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Margaret", "Donald", "Sandra",
    "Mark", "Ashley", "Paul", "Kimberly", "Steven", "Emily", "Andrew", "Donna", "Kenneth", "Michelle",
    "George", "Dorothy", "Joshua", "Carol", "Kevin", "Amanda", "Brian", "Melissa", "Edward", "Deborah"
  ];

  const lastNames = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
    "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
    "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
    "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts"
  ];

  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${first} ${last}`;
}

function prompt(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function getUserByEmail(email) {
  const res = await axios.get(`${BASE_URL}/users/admin/users`);
  const match = res.data.find(user => user.email === email);
  if (!match) throw new Error(`User with email ${email} not found after duplicate`);
  return match;
}

async function registerUser(email, name, role) {
  try {
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      name,
      email,
      password: PASSWORD
    });
      console.log("RES:",res.data);
    const user = res.data;

    if (!user?.id) {
      throw new Error(`User registration succeeded but no user object returned for ${email}`);
    }

    if (role !== 'student') {
      await axios.put(`${BASE_URL}/users/admin/users/${user.id}/role`, { role });
    }

    return user;
  } catch (error) {
    if (error.response?.status === 409) {
      console.warn(`⚠️ Duplicate email for ${email}. Fetching existing user.`);
      const existingUser = await getUserByEmail(email);

      if (existingUser.role !== role && role !== 'student') {
        await axios.put(`${BASE_URL}/users/admin/users/${existingUser.id}/role`, { role });
      }

      return existingUser;
    }

    throw error;
  }
}

async function createClass(name, description, createdBy) {
  const res = await axios.post(`${BASE_URL}/classes`, {
    name,
    description,
    createdBy
  });
  return res.data;
}

async function createCourse(name, code, section, semester, year, instructorId, classId) {
  const res = await axios.post(`${BASE_URL}/courses`, {
    name,
    code,
    section,
    semester,
    year,
    instructor_id: instructorId,
    class_id: classId
  });
  return res.data;
}

async function enrollStudent(courseCode, studentId) {
  await axios.post(`${BASE_URL}/courses/enroll-by-code`, {
    code: courseCode,
    userId: studentId
  });
}

async function main() {
  try {
    const rootEmail = await prompt('Root user email: ');
    const rootUser = await registerUser(rootEmail, 'Root User', 'root');
    console.log(`Root user: ${rootUser.name} (ID: ${rootUser.id})`);

    const creatorTemplate = await prompt('Creator email template (e.g., c@c.c): ');
    const numCreators = parseInt(await prompt('Number of creators: '), 10);
    const creators = [];
    for (let i = 1; i <= numCreators; i++) {
      const email = creatorTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'creator');
      if (user) creators.push(user);
    }

    const instructorTemplate = await prompt('Instructor email template: ');
    const numInstructors = parseInt(await prompt('Number of instructors: '), 10);
    const instructors = [];
    for (let i = 1; i <= numInstructors; i++) {
      const email = instructorTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'instructor');
      if (user) instructors.push(user);
    }

    const studentTemplate = await prompt('Student email template: ');
    const numStudents = parseInt(await prompt('Number of students: '), 10);
    const students = [];
    for (let i = 1; i <= numStudents; i++) {
      const email = studentTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'student');
      if (user) students.push(user);
    }

    const classTemplate = await prompt('Class name template (e.g., cs): ');
    const numClasses = parseInt(await prompt('Number of classes: '), 10);
    const pogilClasses = [];

    for (let i = 1; i <= numClasses; i++) {
      const name = `${classTemplate}${i}`;
      const pogilClass = await createClass(name, `${name} Description`, creators[0].id);
      pogilClasses.push(pogilClass);
    }

    const coursesPerClass = parseInt(await prompt('Number of courses per class: '), 10);

    for (const pogilClass of pogilClasses) {
      for (let i = 1; i <= coursesPerClass; i++) {
        const courseCode = `C${pogilClass.name}${i}`;
        const course = await createCourse(`Course ${i}`, courseCode, `S${i}`, 'spring', 2025, instructors[0].id, pogilClass.id);
        console.log(`✅ Created course: Course ${i} (code: ${courseCode})`);

        for (const student of students) {
          console.log(`→ Enrolling student ${student.id} into ${courseCode}`);
          await enrollStudent(courseCode, student.id);
        }
      }
    }

    console.log('🎉 Test data generation complete.');
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:');
      console.error(`  URL:     ${error.config?.url}`);
      console.error(`  Method:  ${error.config?.method?.toUpperCase()}`);
      console.error(`  Status:  ${error.response.status} ${error.response.statusText}`);
      console.error(`  Message: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('❌ No response received from server:');
      console.error(error.request);
    } else {
      console.error('❌ Request setup error:', error.message);
    }
  } finally {
    rl.close();
  }
  console.log("The passwords are all set to: ",PASSWORD);
}

main();
