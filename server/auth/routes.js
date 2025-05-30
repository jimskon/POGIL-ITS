const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const router = express.Router();
const nodemailer = require('nodemailer');

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate a 6-digit verification code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ✅ Step 1: Register route — store in pending_users & email code
router.post('/register', async (req, res) => {
  console.log('Registering user:', req.body);
  const { name, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const code = generateCode();

    const conn = await pool.getConnection();

    // Prevent duplicate email registration
    const [existing] = await conn.query('SELECT * FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      conn.release();
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Remove old pending entry if exists
    await conn.query('DELETE FROM pending_users WHERE email = ?', [email]);

    // Insert into pending_users
    await conn.query(
      'INSERT INTO pending_users (name, email, password_hash, code) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, code]
    );

    // Send the verification code via email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your POGIL-ITS Verification Code',
      text: `Your confirmation code is: ${code}`
    });

    conn.release();
    res.status(200).json({ message: 'Confirmation code sent to your email.' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ✅ Step 2: Verify code and finalize account creation
router.post('/verify', async (req, res) => {
  const { email, code } = req.body;

  try {
    const conn = await pool.getConnection();

    const [rows] = await conn.query(
      'SELECT * FROM pending_users WHERE email = ? AND code = ?',
      [email, code]
    );

    if (rows.length === 0) {
      conn.release();
      return res.status(400).json({ error: 'Invalid code or email.' });
    }

    const user = rows[0];

    // Insert into real users table
    const [result] = await conn.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [user.name, user.email, user.password_hash]
    );

    // Delete from pending_users
    await conn.query('DELETE FROM pending_users WHERE email = ?', [email]);

    conn.release();
    res.status(201).json({ message: 'Verification successful. Account created.' });

  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});


// ✅ Login route
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

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (match) {
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

// Store reset codes in memory (or use a DB table)
const passwordResetCodes = new Map(); // key = email, value = code

router.post('/request-reset', async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  try {
    // Check if user exists
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
    conn.release();

    if (rows.length === 0) {
      return res.status(400).json({ error: 'No user found with that email.' });
    }

    // Save code temporarily
    passwordResetCodes.set(email, code);

    // Send code via email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'POGIL-ITS Password Reset Code',
      text: `Your reset code is: ${code}`
    });

    res.status(200).json({ message: 'Reset code sent to email.' });
  } catch (err) {
    console.error('Error sending reset code:', err);
    res.status(500).json({ error: 'Failed to send reset code' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  const expectedCode = passwordResetCodes.get(email);

  if (!expectedCode || code !== expectedCode) {
    return res.status(400).json({ error: 'Invalid or expired code.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const conn = await pool.getConnection();
    await conn.query('UPDATE users SET password_hash = ? WHERE email = ?', [hashedPassword, email]);
    conn.release();

    // Remove used code
    passwordResetCodes.delete(email);

    res.status(200).json({ message: 'Password reset successful.' });
  } catch (err) {
    console.error('Reset error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});


module.exports = router;