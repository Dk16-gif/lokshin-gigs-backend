const db = require('../config/db');

async function requireAuth(req, res, next) {
  // Check session first
  if (req.session?.user) return next();

  // Fall back to x-user-id header (for cross-domain localStorage users)
  const userId = req.headers['x-user-id'];
  if (userId) {
    try {
      const [users] = await db.query(
        'SELECT UserID, FullName, Email, Role, RefNumber FROM Users WHERE UserID = ? AND IsActive = 1',
        [userId]
      );
      if (users.length) {
        req.session.user = {
          id:        users[0].UserID,
          name:      users[0].FullName,
          email:     users[0].Email,
          role:      users[0].Role,
          refNumber: users[0].RefNumber
        };
        return next();
      }
    } catch (err) {
      console.error('Auth header check failed:', err.message);
    }
  }

  return res.status(401).json({ success: false, message: 'Please log in to continue.' });
}

function checkRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user)
      return res.status(401).json({ success: false, message: 'Not authenticated.' });
    if (!roles.includes(req.session.user.role))
      return res.status(403).json({ success: false, message: 'Access denied.' });
    next();
  };
}

module.exports = { requireAuth, checkRole };