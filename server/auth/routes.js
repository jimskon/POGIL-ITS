const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const router = express.Router();

router.post('/register', async (req, res) => {
  console.log('Registering user:', req.body);  // log inputs

  const { username, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const conn = await pool.getConnection();

    const result = await conn.query(
	'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    conn.release();
    console.log('Insert result:', result); // confirm insert
    res.status(201).json({ message: 'User registered successfully' });

  } catch (err) {
    console.error('Registration error:', err); // log DB errors
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  console.log('Login user:', req.body);  // log inputs
    const { email, username, password } = req.body;
  try {
    const conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
    conn.release();

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    console.log('Password:',password,user.password_hash);
    const match = await bcrypt.compare(password, user.password_hash);

    if (match) {
      // Implement session logic here
      res.status(200).json({ message: 'Login successful' });
    } else {
      res.status(400).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

module.exports = router;

