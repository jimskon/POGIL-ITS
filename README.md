# POGIL-ITS

**An Intelligent Tutoring System for Process Oriented Guided Inquiry Learning**

## About POGIL-ITS

POGIL-ITS is a web-based intelligent tutoring system designed to facilitate collaborative, inquiry-based learning activities. It provides an interactive platform where students work together in small groups on Process Oriented Guided Inquiry Learning (POGIL) activities with real-time AI-powered feedback and guidance.

### What is POGIL?

POGIL (Process Oriented Guided Inquiry Learning) is an evidence-based pedagogy that uses guided inquiry and collaborative learning to help students develop critical thinking and problem-solving skills. Students work in teams on specially designed activities that guide them through an exploration to construct understanding.

### What Does POGIL-ITS Do?

POGIL-ITS enhances traditional POGIL activities by providing:

- **Dynamic Activity Delivery**: Activities are loaded from Google Docs with custom markup language support
- **Intelligent Feedback**: AI-powered evaluation of student responses using OpenAI's GPT models
- **Interactive Coding Environment**: Built-in Python code execution with Skulpt for programming activities, including turtle graphics support
- **Real-time Collaboration**: Live synchronization between group members using WebSockets
- **Role-Based Learning**: Support for POGIL team roles (Manager, Recorder, Presenter, Quality Control, etc.)
- **Instructor Dashboard**: Tools for instructors to create courses, manage students, and monitor group progress
- **Activity Management**: Create, organize, and deploy POGIL activities across multiple courses

## Key Features

- 🎓 **Multi-role Support**: Students, Instructors, Creators, and Root users with appropriate permissions
- 🤖 **AI-Powered Feedback**: Contextual feedback and follow-up questions based on student responses
- 💻 **Python Code Execution**: Run and test Python code directly in the browser
- 👥 **Group Collaboration**: Real-time synchronization of code and responses within student groups
- 📊 **Progress Tracking**: Monitor student and group progress through activities
- 📝 **Custom Markup Language**: Rich activity authoring with LaTeX-inspired syntax
- 🔄 **Activity Instances**: Multiple groups can work on the same activity simultaneously
- 🎨 **Turtle Graphics**: Visual programming support with Python turtle module

## Technology Stack

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and development server
- **React Router** - Client-side routing
- **React Bootstrap** - UI components
- **Socket.IO Client** - Real-time communication
- **Skulpt** - In-browser Python execution
- **Prism.js** - Code syntax highlighting

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web application framework
- **Socket.IO** - WebSocket server for real-time features
- **MariaDB/MySQL** - Relational database
- **OpenAI API** - AI-powered feedback generation
- **Google Docs API** - Activity content management
- **bcrypt** - Password hashing
- **express-session** - Session management

### Infrastructure
- **Apache** - Web server and reverse proxy
- **PM2** - Process manager (optional)

---

# Installation Guide

This guide walks through installing Apache, MariaDB, Node.js, and setting up the POGIL ITS project on Ubuntu 24.04.

---

## 1. System Update

```bash
sudo apt update && sudo apt upgrade -y
```

---

## 2. Install Apache

```bash
sudo apt install apache2 -y
sudo systemctl enable apache2
sudo systemctl start apache2
```

---

## 3. Install MariaDB

```bash
sudo apt install mariadb-server -y
sudo systemctl enable mariadb
sudo systemctl start mariadb
```

Run the secure setup:

```bash
sudo mysql_secure_installation
```

Answer the prompts to:
- Set a root password
- Remove anonymous users
- Disallow remote root login
- Remove test DB
- Reload privileges

---

## 4. Create the Database

```bash
sudo mysql -u root -p
```

Then inside the MariaDB prompt:

```sql
CREATE DATABASE pogil_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'pogil_user'@'localhost' IDENTIFIED BY 'secretxyz';
GRANT ALL PRIVILEGES ON pogil_db.* TO 'pogil_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### To regenreate the database after a change
```
sudo mysql -u root -p
drop database pogil_db;
CREATE DATABASE pogil_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
FLUSH PRIVILEGES;
EXIT;
mysql -u pogil_user -p pogil_db < schema.sql
```

### Install phpmyadmin
```
sudo apt install phpmyadmin php-mbstring php-zip php-gd php-json php-curl -y
sudo phpenmod mbstring
sudo systemctl restart apache2

sudo apt install php libapache2-mod-php php-mysql -y

sudo ln -s /etc/phpmyadmin/apache.conf /etc/apache2/conf-available/phpmyadmin.conf
sudo a2enconf phpmyadmin
sudo systemctl reload apache2
```

---

##  5. Install Node.js & npm (LTS)

```
sudo apt install curl -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
```

---

## 6. Clone & Setup POGIL ITS Code

```bash
git clone https://github.com/jimskon/POGIL-ITS.git
cd POGIL-ITS
```

---

## 7. Backend Setup (Express + MariaDB)
If installing from the clone repository:
```
cd server
npm install
cd ../client
npm install
cd ..
mysql -u root -p
CREATE DATABASE pogil_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'pogil_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON pogil_db.* TO 'pogil_user'@'localhost';
FLUSH PRIVILEGES;

mysql -u pogil_user -p pogil_db < schema.sql
```
If installing from ground up...
```
cd server
cp .env.example .env  # or create a new .env
npm install
npm install express-session
npm install bcrypt
npm install mariadb
npm install googleapis
npm install mysql2
npm install react-router-bootstrap
npm install jsdom
npm install openai

cd ../client
npm install react-bootstrap bootstrap
npm install prismjs
npm install express-session
npm install react-icons

```

Edit `server/.env`:

```
# Server
PORT=4000

# MariaDB
DB_HOST=localhost
DB_PORT=3306
DB_USER=pogil_user
DB_PASSWORD=secret!!!
DB_NAME=pogil_db
SESSION_SECRET=PhilanderChaseLovesPogil

# Google API
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=your-google-redirect-uri


# OpenAI API
OPENAI_API_KEY=APIKe
```

Make sure everything is installed:
```
rm -rf node_modules package-lock.json
npm install
```

Start the server:

```
npm run start
```

---

## 8. Frontend Setup (React + Vite)

```
cd ../client
npm install
npm run build
```

This creates the production frontend in `client/dist`.

Create a `.env` file in `client/`
```
VITE_API_BASE_URL=http://this-ip-address:4000
```

---

## 9. Configure Apache (Frontend + Proxy API)

Create a new Apache site config:

```
sudo emacs /etc/apache2/sites-available/pogil.conf
```

Example config:

```
<VirtualHost *:80>
    ServerName yourdomain.com
    DocumentRoot /path/to/POGIL-ITS/client/dist

    <Directory /path/to/POGIL-ITS/client/dist>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ProxyPreserveHost On
    ProxyPass /api http://localhost:4000/
    ProxyPassReverse /api http://localhost:4000/

    ErrorLog ${APACHE_LOG_DIR}/pogil_error.log
    CustomLog ${APACHE_LOG_DIR}/pogil_access.log combined
</VirtualHost>
```

Enable site and proxy modules:

```
sudo a2enmod proxy proxy_http
sudo a2ensite pogil
sudo systemctl reload apache2
```

---


## Final Notes

- Frontend served from: `http://yourdomain.com/`
- API served from: `http://yourdomain.com/api/...`
- Express runs on port `4000`
- MariaDB stores user, class, and activity data

---

## Optional: Add HTTPS (Let’s Encrypt)

```bash
sudo apt install certbot python3-certbot-apache -y
sudo certbot --apache
```

Database:
```
CREATE DATABASE pogil_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'pogil_user'@'localhost' IDENTIFIED BY 'strong_password_here';
GRANT ALL PRIVILEGES ON pogil_db.* TO 'pogil_user'@'localhost';
FLUSH PRIVILEGES;

mysql -u pogil_user -p pogil_db < schema.sql
```

.env
```
# Server
PORT=4000

# MariaDB
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=its_database

OPENAI_API_KEY=APIKey 
```

## Rebuild:
```
cd POGIL-ITS/client
npm run build
cd ../server
npm start
```

## To build for production
```
cd client
npx vite build --base=/its/
```

# When moving to a new host:
## You must create a `server/.env` and `client/.env1`
server/.env
```
# Server
PORT=4000

# MariaDB
DB_HOST=localhost
DB_PORT=3306
DB_USER=pogil_user
DB_PASSWORD=ask for this
DB_NAME=pogil_db
SESSION_SECRET=ask for this

# Google API
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=your-google-redirect-uri

# OpenAI API
OPENAI_API_KEY=APIKey  --  ask for this
```

client/.env
```
VITE_API_BASE_URL=http://YOURSEVERIPorDNS:4000
VITE_SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@pogil-its.iam.gserviceaccount.com
```

## Service account for access to google docs:
`server/utils/service-account.json`
You must get this from Jim Skon

## To get the schma from mysql
mysqldump -u root -p --no-data --routines --triggers pogil_db > pogil_db_full_schema.sql

---

## Usage

### For Students
1. Register for an account or log in
2. Enroll in a course using the course code provided by your instructor
3. Join a group activity when started by your instructor
4. Collaborate with your team on POGIL activities
5. Receive real-time AI feedback on your responses

### For Instructors
1. Create a course and share the enrollment code with students
2. Add POGIL activities from Google Docs to your course
3. Start activity instances for student groups
4. Monitor student progress in real-time
5. Review completed activities and student responses

### For Activity Creators
1. Create POGIL activities using Google Docs
2. Use the POGIL markup language (see MarkUp.md) for formatting
3. Include special tags for AI guidance and code exercises
4. Share activities with instructors

## Project Structure

```
POGIL-ITS/
├── client/                 # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable React components
│   │   ├── pages/         # Page components
│   │   ├── context/       # React context providers
│   │   ├── utils/         # Utility functions
│   │   └── routes/        # Routing configuration
│   └── dist/              # Production build output
├── server/                # Express.js backend
│   ├── activities/        # Activity management routes
│   ├── auth/              # Authentication routes
│   ├── courses/           # Course management routes
│   ├── groups/            # Group management routes
│   ├── ai/                # AI feedback controller
│   └── index.js           # Main server file
├── schema.sql             # Database schema
├── MarkUp.md              # POGIL markup language guide
├── er.md                  # Entity-relationship diagram
└── README.md              # This file
```

## Documentation

- **MarkUp.md** - Complete guide to POGIL markup language for activity authoring
- **er.md** - Database entity-relationship diagram
- **CPPREADME.md** - Additional notes on C++ support (experimental)
- **Production.md** - Production deployment notes

## Contributing

This project is developed for educational purposes. For questions or contributions, please contact the project maintainer.

## License

This project is maintained by Kenyon College. Please contact the repository owner for licensing information.

## Support

For technical support or questions about POGIL-ITS, please open an issue on the GitHub repository.


# To reset git back to head
```
git reset --hard HEAD
```

# If the server is corrupted
```
rm -rf node_modules package-lock.json
npm install
```
# UTF32 error
```
rm -rf node_modules package-lock.json
npm install
```
# Background operation
```
nohup npm start > out.log 2>&1 &
```

Or - to run so it restarts if stopped:
```
npm install -g pm2
pm2 start index.js --name POGIL-ITS
pm2 save
pm2 startup
```
to restart:
```
pm2 restart
```

# Create rsa key
```
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
```
# Reset Node.js/React Enviornment
Backend (Node.js):
```
rm -rf node_modules package-lock.json
npm install
```
Frontend (React):
```
cd client  # or wherever your React app lives
rm -rf node_modules package-lock.json
npm install
```

# Added a new field to activity_instances table 
```
mysql -u pogil_user -p
USE pogil_db;
ALTER TABLE activity_instances
ADD COLUMN total_groups INT DEFAULT NULL;

```
