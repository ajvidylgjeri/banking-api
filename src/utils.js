const jwt = require('jsonwebtoken');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Wrap async route handlers so rejected promises reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(body) {
  const { name, email, password } = body || {};
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name is required');
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) throw new HttpError(400, 'A valid email is required');
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'password must be at least 8 characters');
  }
  return { name: name.trim(), email: email.trim().toLowerCase(), password };
}

function parseId(value, label = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}`);
  return n;
}

function parsePaging(query, maxLimit = 50) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  });
}

function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.status) return res.status(err.status).json({ error: err.message, ...err.extra });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Resource already exists' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { HttpError, ah, validateSignup, parseId, parsePaging, signToken, notFound, errorHandler };
