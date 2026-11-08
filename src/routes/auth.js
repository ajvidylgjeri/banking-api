const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { ah, HttpError, validateSignup, signToken } = require('../utils');

// POST /signup  { name, email, password }
// Public signup ALWAYS creates a customer. Admins are created with `npm run seed:admin`.
router.post('/signup', ah(async (req, res) => {
  const { name, email, password } = validateSignup(req.body);
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'customer')", [name, email, hash]);
  const user = { id: r.insertId, role: 'customer' };
  res.status(201).json({ message: 'Account created', user: { id: user.id, name, email, role: 'customer' }, token: signToken(user) });
}));

// POST /login  { email, password }
router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') throw new HttpError(400, 'email and password are required');
  const [rows] = await pool.query('SELECT id, name, email, password, role FROM users WHERE email=?', [email.trim().toLowerCase()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) throw new HttpError(401, 'Invalid email or password');
  res.json({ message: 'Login successful', user: { id: user.id, name: user.name, email: user.email, role: user.role }, token: signToken(user) });
}));

module.exports = router;
