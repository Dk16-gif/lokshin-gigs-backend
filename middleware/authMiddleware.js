function requireAuth(req, res, next) {
  if (!req.session?.user)
    return res.status(401).json({ success: false, message: 'Please log in to continue.' });
  next();
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
