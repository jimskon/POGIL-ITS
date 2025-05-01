const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const app = express();
const PORT = process.env.PORT || 4000;

require('dotenv').config();

const staticDir = path.join(__dirname, '../client/dist');
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if using HTTPS
}));

console.log('Resolved staticDir:', staticDir);

// ✅ Serve frontend static assets
app.use(express.static(staticDir));

// API routes

// API routes (all now under /api)
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

// Let React handle all non-API paths (client-side routing)
app.all('*', (req, res) => {
  console.log(`📦 React route hit: ${req.method} ${req.originalUrl}`);
  res.sendFile(path.resolve(staticDir, 'index.html'));
});

app.listen(PORT, () => console.log(`ITS server running on port ${PORT}`));


