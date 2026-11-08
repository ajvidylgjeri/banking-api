// Creates the first admin (bank manager). Usage: npm run seed:admin
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

(async () => {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 8 chars) in .env');
    process.exit(1);
  }
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await pool.query(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin') ON DUPLICATE KEY UPDATE role='admin', password=VALUES(password)",
    [ADMIN_NAME || 'Bank Manager', ADMIN_EMAIL.toLowerCase(), hash]
  );
  console.log(`Admin ready: ${ADMIN_EMAIL}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
