const express = require('express');
const crypto = require('crypto');
const authenticate = require('../middleware/auth');

const router = express.Router();

router.get('/turn-credentials', authenticate, (req, res) => {
  const turnServer = process.env.TURN_SERVER;
  const turnSecret = process.env.TURN_SECRET;

  if (!turnServer || !turnSecret) {
    return res.json({ iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]});
  }

  const ttl = 24 * 60 * 60;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;
  const username = `${timestamp}:${req.user.id}`;
  const credential = crypto
    .createHmac('sha1', turnSecret)
    .update(username)
    .digest('base64');

  res.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: turnServer,
        username,
        credential,
      },
    ],
    ttl,
  });
});

module.exports = router;
