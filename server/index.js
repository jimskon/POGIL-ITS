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
app.use('/auth', require('./auth/routes'));
app.use('/users', require('./users/routes'));
app.use('/courses', require('./courses/routes'));
app.use('/activities', require('./activities/routes'));
app.use('/groups', require('./groups/routes'));
app.use('/responses', require('./responses/routes'));
app.use('/events', require('./events/routes'));
app.use('/classes', require('./classes/routes'));
app.use('/users', require('./users/routes'));

// Safe React SPA fallback
console.log('Pre front end',staticDir,);
if (fs.existsSync(path.join(staticDir, 'index.html'))) {
  console.log('Pre get ',staticDir,);
  app.all('*', (req, res) => {
      console.log('Pre sendFile ',staticDir,);
      res.sendFile(path.resolve(staticDir, 'index.html'));
  });
} else {
  console.warn('⚠️  index.html not found in client/dist.');
}


app.listen(PORT, () => console.log(`ITS server running on port ${PORT}`));


