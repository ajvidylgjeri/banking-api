const router = require('express').Router();
const { pool } = require('../db');
const { ah, HttpError, parseId, parsePaging } = require('../utils');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('admin'));

// GET /admin/users
router.get('/admin/users', ah(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query, 100);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM users');
  const [users] = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY id LIMIT ? OFFSET ?', [limit, offset]);
  res.json({ page, limit, total, users });
}));

// GET /admin/accounts
router.get('/admin/accounts', ah(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query, 100);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM accounts');
  const [accounts] = await pool.query(
    `SELECT a.id, a.account_number, a.account_type, a.balance, a.status, u.name AS account_holder, u.email
       FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY a.id LIMIT ? OFFSET ?`, [limit, offset]);
  res.json({ page, limit, total, accounts });
}));

// GET /admin/transactions
router.get('/admin/transactions', ah(async (req, res) => {
  const { page, limit, offset } = parsePaging(req.query, 100);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM transactions');
  const [transactions] = await pool.query(
    `SELECT t.id, t.type, t.amount, t.timestamp, fa.account_number AS from_account, ta.account_number AS to_account
       FROM transactions t JOIN accounts fa ON fa.id = t.from_account LEFT JOIN accounts ta ON ta.id = t.to_account
      ORDER BY t.timestamp DESC, t.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  res.json({ page, limit, total, transactions });
}));

// PUT /admin/accounts/:id/block | /unblock  (optional feature)
for (const [action, status] of [['block', 'blocked'], ['unblock', 'active']]) {
  router.put(`/admin/accounts/:id/${action}`, ah(async (req, res) => {
    const [r] = await pool.query('UPDATE accounts SET status=? WHERE id=?', [status, parseId(req.params.id)]);
    if (!r.affectedRows) throw new HttpError(404, 'Account not found');
    res.json({ message: `Account ${status === 'blocked' ? 'blocked' : 'unblocked'}`, status });
  }));
}

module.exports = router;
