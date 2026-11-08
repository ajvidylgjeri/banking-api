const router = require('express').Router();
const { pool, withTransaction } = require('../db');
const { ah, HttpError, parseId, parsePaging } = require('../utils');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 50000); // max debited per account per day (withdraw + transfer)
const MAX_SINGLE = 1000000;

/** Validate an amount: positive, max 2 decimals. Returns a fixed 2-decimal string. */
function parseAmount(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new HttpError(400, 'amount must be a positive number');
  if (Math.round(n * 100) / 100 !== n) throw new HttpError(400, 'amount can have at most 2 decimal places');
  if (n > MAX_SINGLE) throw new HttpError(400, `amount cannot exceed ${MAX_SINGLE} per transaction`);
  return n.toFixed(2);
}

/** Find the caller's own account. account_number may be omitted if the user has exactly one account. */
async function ownAccount(conn, userId, accountNumber) {
  let sql = 'SELECT * FROM accounts WHERE user_id=?';
  const params = [userId];
  if (accountNumber !== undefined && accountNumber !== null && accountNumber !== '') {
    sql += ' AND account_number=?';
    params.push(String(accountNumber));
  }
  const [rows] = await conn.query(sql, params);
  if (!rows.length) throw new HttpError(404, 'Account not found (is the account_number yours?)');
  if (rows.length > 1) throw new HttpError(400, 'You have several accounts; please provide account_number');
  return rows[0];
}

async function lockAccounts(conn, ids) {
  // Always lock in ascending id order so two opposite transfers can never deadlock.
  const [rows] = await conn.query('SELECT * FROM accounts WHERE id IN (?) ORDER BY id FOR UPDATE', [ids]);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function assertActive(acc, label = 'Account') {
  if (acc.status !== 'active') throw new HttpError(403, `${label} ${acc.account_number} is blocked`);
}

async function assertDailyLimit(conn, accountId, amount) {
  const [[{ spent }]] = await conn.query(
    "SELECT COALESCE(SUM(amount),0) AS spent FROM transactions WHERE from_account=? AND type IN ('withdraw','transfer') AND timestamp >= CURDATE()",
    [accountId]);
  if (Number(spent) + Number(amount) > DAILY_LIMIT) {
    throw new HttpError(422, `Daily transaction limit of ${DAILY_LIMIT} exceeded`, { spent_today: spent });
  }
}

/** Debit with overdraft guard: the WHERE clause makes it atomic. */
async function debit(conn, accountId, amount) {
  const [r] = await conn.query('UPDATE accounts SET balance = balance - ? WHERE id=? AND balance >= ?', [amount, accountId, amount]);
  if (!r.affectedRows) throw new HttpError(422, 'Insufficient funds');
}

async function balanceOf(conn, id) {
  const [[row]] = await conn.query('SELECT account_number, balance FROM accounts WHERE id=?', [id]);
  return row;
}

// POST /deposit  { account_number?, amount }
router.post('/deposit', authorize('customer'), ah(async (req, res) => {
  const amount = parseAmount(req.body && req.body.amount);
  const out = await withTransaction(async (conn) => {
    const found = await ownAccount(conn, req.user.id, req.body.account_number);
    const acc = (await lockAccounts(conn, [found.id]))[found.id];
    assertActive(acc);
    await conn.query('UPDATE accounts SET balance = balance + ? WHERE id=?', [amount, acc.id]);
    const [t] = await conn.query("INSERT INTO transactions (from_account, to_account, amount, type) VALUES (?, NULL, ?, 'deposit')", [acc.id, amount]);
    return { transaction_id: t.insertId, ...(await balanceOf(conn, acc.id)) };
  });
  res.status(201).json({ message: 'Deposit successful', amount, ...out });
}));

// POST /withdraw  { account_number?, amount }
router.post('/withdraw', authorize('customer'), ah(async (req, res) => {
  const amount = parseAmount(req.body && req.body.amount);
  const out = await withTransaction(async (conn) => {
    const found = await ownAccount(conn, req.user.id, req.body.account_number);
    const acc = (await lockAccounts(conn, [found.id]))[found.id];
    assertActive(acc);
    await assertDailyLimit(conn, acc.id, amount);
    await debit(conn, acc.id, amount);
    const [t] = await conn.query("INSERT INTO transactions (from_account, to_account, amount, type) VALUES (?, NULL, ?, 'withdraw')", [acc.id, amount]);
    return { transaction_id: t.insertId, ...(await balanceOf(conn, acc.id)) };
  });
  res.status(201).json({ message: 'Withdrawal successful', amount, ...out });
}));

// POST /transfer  { from_account?, to_account, amount }
router.post('/transfer', authorize('customer'), ah(async (req, res) => {
  const amount = parseAmount(req.body && req.body.amount);
  const toNumber = req.body.to_account;
  if (!toNumber) throw new HttpError(400, 'to_account (account number) is required');
  const out = await withTransaction(async (conn) => {
    const src = await ownAccount(conn, req.user.id, req.body.from_account);
    const [dest] = await conn.query('SELECT id FROM accounts WHERE account_number=?', [String(toNumber)]);
    if (!dest.length) throw new HttpError(404, 'Destination account not found');
    if (dest[0].id === src.id) throw new HttpError(400, 'Cannot transfer to the same account');
    const locked = await lockAccounts(conn, [src.id, dest[0].id]);
    assertActive(locked[src.id], 'Source account');
    assertActive(locked[dest[0].id], 'Destination account');
    await assertDailyLimit(conn, src.id, amount);
    await debit(conn, src.id, amount);
    await conn.query('UPDATE accounts SET balance = balance + ? WHERE id=?', [amount, dest[0].id]);
    const [t] = await conn.query("INSERT INTO transactions (from_account, to_account, amount, type) VALUES (?, ?, ?, 'transfer')", [src.id, dest[0].id, amount]);
    return { transaction_id: t.insertId, to_account: locked[dest[0].id].account_number, from: await balanceOf(conn, src.id) };
  });
  res.status(201).json({ message: 'Transfer successful', amount, ...out });
}));

const TX_SELECT = `SELECT t.id, t.type, t.amount, t.timestamp,
                          fa.account_number AS from_account, ta.account_number AS to_account
                     FROM transactions t
                     JOIN accounts fa ON fa.id = t.from_account
                     LEFT JOIN accounts ta ON ta.id = t.to_account`;

/** Shared filter builder: ?type=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=&limit= */
function buildFilters(query, base, params) {
  const where = [base];
  if (query.type) {
    if (!['deposit', 'withdraw', 'transfer'].includes(query.type)) throw new HttpError(400, 'type must be deposit, withdraw or transfer');
    where.push('t.type = ?'); params.push(query.type);
  }
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (query.from) {
    if (!date.test(query.from)) throw new HttpError(400, 'from must be YYYY-MM-DD');
    where.push('t.timestamp >= ?'); params.push(query.from);
  }
  if (query.to) {
    if (!date.test(query.to)) throw new HttpError(400, 'to must be YYYY-MM-DD');
    where.push('t.timestamp < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(query.to);
  }
  return where.join(' AND ');
}

async function listTransactions(res, query, base, baseParams) {
  const { page, limit, offset } = parsePaging(query, 100);
  const params = [...baseParams];
  const clause = buildFilters(query, base, params);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM transactions t WHERE ${clause}`, params);
  const [rows] = await pool.query(`${TX_SELECT} WHERE ${clause} ORDER BY t.timestamp DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ page, limit, total, transactions: rows });
}

// GET /transactions?type=&from=&to=&account_number=&page=&limit=   (customer: own history)
router.get('/transactions', authorize('customer'), ah(async (req, res) => {
  const [accs] = await pool.query('SELECT id, account_number FROM accounts WHERE user_id=?', [req.user.id]);
  let ids = accs.map((a) => a.id);
  if (req.query.account_number) {
    const mine = accs.find((a) => a.account_number === String(req.query.account_number));
    if (!mine) throw new HttpError(404, 'Account not found');
    ids = [mine.id];
  }
  if (!ids.length) return res.json({ page: 1, limit: 10, total: 0, transactions: [] });
  await listTransactions(res, req.query, '(t.from_account IN (?) OR t.to_account IN (?))', [ids, ids]);
}));

// GET /transactions/:accountId  (admin only)
router.get('/transactions/:accountId', authorize('admin'), ah(async (req, res) => {
  const id = parseId(req.params.accountId, 'accountId');
  await listTransactions(res, req.query, '(t.from_account = ? OR t.to_account = ?)', [id, id]);
}));

module.exports = router;
