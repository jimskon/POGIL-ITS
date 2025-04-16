# POGIL-ITS
A system for dynamic intelligent POGILs


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
