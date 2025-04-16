const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 4000;

const staticDir = path.join(__dirname, '../client/dist');
app.use(express.json());

console.log('Resolved staticDir:', staticDir);
// Add debugging for each route import
console.log('AUTH ROUTES:', require('./auth/routes'));
console.log('USER ROUTES:', require('./users/routes'));
console.log('COURSE ROUTES:', require('./courses/routes'));
console.log('COURSE ACTIVITIES:', require('./activities/routes'));
console.log('COURSE GROUPS:', require('./groups/routes'));
console.log('COURSE RESPONSES:', require('./responses/routes'));
console.log('COURSE EVENT:', require('./events/routes'));



// API routes
app.use('/auth', require('./auth/routes'));
app.use('/users', require('./users/routes'));
app.use('/courses', require('./courses/routes'));
app.use('/activities', require('./activities/routes'));
app.use('/groups', require('./groups/routes'));
app.use('/responses', require('./responses/routes'));
app.use('/events', require('./events/routes'));

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


