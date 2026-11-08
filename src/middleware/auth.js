const jwt = require('jsonwebtoken');
const { HttpError } = require('../utils');

/** Requires a valid "Authorization: Bearer <jwt>" header. Sets req.user = { id, role }. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

/** Role guard: authorize('admin') or authorize('candidate', 'employer'). Use after authenticate. */
const authorize = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have permission to access this resource'));

module.exports = { authenticate, authorize };
