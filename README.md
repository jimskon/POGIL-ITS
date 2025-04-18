# POGIL-ITS
A system for dynamic intelligent POGILs

Install:
# POGIL ITS Setup on Ubuntu 24.04

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
sudo mariadb -u root -p
```

Then inside the MariaDB prompt:

```sql
CREATE DATABASE pogil_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER 'pogil_user'@'localhost' IDENTIFIED BY 'secretxyz';
GRANT ALL PRIVILEGES ON pogil_db.* TO 'pogil_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

##  5. Install Node.js & npm (LTS)

```bash
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

```bash
cd server
cp .env.example .env  # or create a new .env
npm install
npm install express-session
npm install bcrypt
npm install mariadb
```

Edit `.env`:

```env
DB_HOST=localhost
DB_USER=pogiluser
DB_PASS=securepassword
DB_NAME=pogil_db
PORT=4000
SESSION_SECRET=your-secret-key
```

Start the server:

```bash
npm run start
```

---

## 8. Frontend Setup (React + Vite)

```bash
cd ../client
npm install
npm run build
```

This creates the production frontend in `client/dist`.

---

## 9. Configure Apache (Frontend + Proxy API)

Create a new Apache site config:

```bash
sudo emacs /etc/apache2/sites-available/pogil.conf
```

Example config:

```apache
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

```bash
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

# Google API
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=your-google-redirect-uri
```

Rebuild:
```
cd POGIL-ITS/client
npm run build
cd ../server
npm start
```
