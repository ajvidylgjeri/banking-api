const crypto = require('crypto');
const router = require('express').Router();
const { pool } = require('../db');
const { ah, HttpError, parseId } = require('../utils');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const ACCOUNT_TYPES = ['savings', 'current'];
const SELECT_ACCOUNT = `SELECT a.id, a.account_number, a.account_type, a.balance, a.status, a.created_at,
                               u.name AS account_holder, u.email
                          FROM accounts a JOIN users u ON u.id = a.user_id`;

function newAccountNumber() {
  return String(crypto.randomInt(0, 10 ** 10)).padStart(10, '0');
}

// POST /account/create  { account_type: "savings" | "current" }
router.post('/account/create', authorize('customer'), ah(async (req, res) => {
  const type = String((req.body && req.body.account_type) || '').toLowerCase();
  if (!ACCOUNT_TYPES.includes(type)) throw new HttpError(400, `account_type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [r] = await pool.query('INSERT INTO accounts (user_id, account_number, account_type) VALUES (?, ?, ?)',
        [req.user.id, newAccountNumber(), type]);
      const [rows] = await pool.query(`${SELECT_ACCOUNT} WHERE a.id=?`, [r.insertId]);
      return res.status(201).json({ message: 'Account created', account: rows[0] });
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e; // account number collision -> retry
    }
  }
  throw new HttpError(500, 'Could not generate a unique account number, please retry');
}));

// GET /account/me  - the logged-in customer's account(s): details + balance
router.get('/account/me', authorize('customer'), ah(async (req, res) => {
  const [rows] = await pool.query(`${SELECT_ACCOUNT} WHERE a.user_id=? ORDER BY a.id`, [req.user.id]);
  res.json({ accounts: rows });
}));

// GET /account/:id  (admin only)
router.get('/account/:id', authorize('admin'), ah(async (req, res) => {
  const [rows] = await pool.query(`${SELECT_ACCOUNT} WHERE a.id=?`, [parseId(req.params.id)]);
  if (!rows.length) throw new HttpError(404, 'Account not found');
  res.json({ account: rows[0] });
}));

module.exports = router;
