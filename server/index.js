// In server/index.js

const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const app = express();
const PORT = process.env.PORT || 4000;
const aiRoutes = require('./ai/routes');


require('dotenv').config();
require('./heartbeatCleaner');


const db = require('./db'); // Make sure db is accessible

const staticDir = path.join(__dirname, '../client/dist');
app.use(express.json());

app.use('/api/ai', aiRoutes);

app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // Set to true in production if using HTTPS
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  }
}));

// ✅ Restore req.user from session if available
app.use(async (req, res, next) => {
  if (req.session.userId && !req.user) {
    try {
      const [[user]] = await db.query(
        'SELECT id, name, email, role FROM users WHERE id = ?',
        [req.session.userId]
      );
      if (user) {
        req.user = user;
        //console.log('✅ req.user restored from session:', req.user);
      }
    } catch (err) {
      console.error('❌ Error restoring user from session:', err);
    }
  }
  next();
});

console.log('Resolved staticDir:', staticDir);

// ✅ Serve frontend static assets
app.use(express.static(staticDir));

// ✅ Register API routes
app.use('/api/auth', require('./auth/routes'));
app.use('/api/users', require('./users/routes'));
app.use('/api/courses', require('./courses/routes'));
app.use('/api/activities', require('./activities/routes'));
app.use('/api/groups', require('./groups/routes'));
app.use('/api/responses', require('./responses/routes'));
app.use('/api/events', require('./events/routes'));
app.use('/api/classes', require('./classes/routes'));
app.use('/api/activity-instances', require('./activity_instances/routes'));


// Log and handle unmatched API routes first
app.use('/api', (req, res, next) => {
  console.warn(`⚠️ Unknown API route accessed: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'API route not found' });
});

// Let React handle all non-API paths
app.all('*', (req, res) => {
  console.log(`📦 React route hit: ${req.method} ${req.originalUrl}`);
  res.sendFile(path.resolve(staticDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`ITS server running on port ${PORT}`));
