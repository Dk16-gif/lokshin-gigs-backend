// Only a server-side session created by a real login (email/password or Google) is accepted.
// Client-supplied identity headers such as x-user-id are never trusted.
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ success: false, message: 'Please log in to continue.' });
}

// Used by the verification routes. Also refuses any session still tagged by the
// retired x-user-id fallback (authSource 'header'), e.g. one created before this deploy.
function requireSession(req, res, next) {
  const user = req.session?.user;
  if (user && user.authSource !== 'header') return next();
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

module.exports = { requireAuth, requireSession, checkRole };