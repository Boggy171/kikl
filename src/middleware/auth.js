const crypto = require('crypto');

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

// Fails closed: no API_KEY on the server means no access at all.
const authenticate = (req, res, next) => {
  const expected = process.env.API_KEY;
  if (!expected) return res.status(500).json({ error: 'Server is not configured' });

  const received = req.headers['x-api-key'];
  if (!received || !safeEqual(received, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

module.exports = authenticate;
