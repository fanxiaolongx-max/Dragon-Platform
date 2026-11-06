const req = require('supertest');
const express = require('express');
const app = express();
app.use(express.json());

// Mock requireAuth
app.use((req, res, next) => next());

app.use('/api/sla', require('./backend/routes/sla'));
app.use('/api/storage', require('./backend/routes/storage'));

const request = req(app);

(async () => {
  try {
    console.log('Testing /api/sla/config ...');
    let res = await request.get('/api/sla/config');
    console.log('config status:', res.status, res.body);

    console.log('Testing /api/sla/targets ...');
    res = await request.get('/api/sla/targets');
    console.log('targets status:', res.status, res.body);

    console.log('Testing /api/storage/status ...');
    res = await request.get('/api/storage/status');
    console.log('storage status:', res.status, res.body);

  } catch(e) {
    console.error(e);
  }
})();
