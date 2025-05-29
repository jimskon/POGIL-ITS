const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const router = express.Router();

// ✅ Register new user and return user object
router.post('/register', async (req, res) => {
  console.log('Registering user:', req.body);
  const { name, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const conn = await pool.getConnection();

    // Insert the user
    const [result] = await conn.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hashedPassword]
    );

    const userId = result.insertId;

    // Retrieve the inserted user (excluding password_hash)
    const [rows] = await conn.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [userId]
    );

    conn.release();

    if (rows.length === 0) {
      return res.status(500).json({ error: 'User created but not found' });
    }

    const user = rows[0];
    res.status(201).json(user);
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});


// ✅ Login user
router.post('/login', async (req, res) => {
  console.log('Login attempt:', req.body);
  const { email, password } = req.body;

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    conn.release();

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const user = { ...rows[0] }; // ✅ Convert RowDataPacket to plain object
    const match = await bcrypt.compare(password, user.password_hash);

if (match) {
  // Save user ID in session
  req.session.userId = user.id;

  res.status(200).json({
    id: user.id,
    name: user.name,
    role: user.role
  });

    } else {
      res.status(400).json({ error: 'Invalid email or password' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ✅ Get current logged-in user
router.get('/whoami', async (req, res) => {
  const userId = req.session.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [userId]
    );
    conn.release();

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    res.json(user);
  } catch (err) {
    console.error('whoami error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

module.exports = router;
