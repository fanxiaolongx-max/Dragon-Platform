const express = require('express');
const app = express();
const uivRoute = require('./backend/routes/uiv');
app.use(express.json());
app.use('/api/uiv', uivRoute);
const server = app.listen(0, async () => {
  const port = server.address().port;
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/api/uiv/scripts');
    console.log('STATUS:', res.status);
    console.log('JSON:', await res.json());
  } catch(e) {
    console.error('ERROR:', e.message);
  }
  process.exit(0);
});
