'use strict';

module.exports = function handler(req, res) {
  res.setHeader('Set-Cookie',
    'bh_session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/'
  );
  res.status(200).json({ ok: true });
};
