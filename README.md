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
