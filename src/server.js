require('dotenv').config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('JWT_SECRET must be set in .env (at least 16 characters).');
  process.exit(1);
}
if (!process.env.DB_NAME) {
  console.error('DB_NAME must be set in .env.');
  process.exit(1);
}

const app = require('./app');
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
