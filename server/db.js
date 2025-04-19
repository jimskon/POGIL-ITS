const mariadb = require('mariadb');
require('dotenv').config();

console.log("Connecting to DB as:", process.env.DB_USER, "with pass?", !!process.env.DB_PASS);

const pool = mariadb.createPool({

  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5
});

module.exports = pool;
