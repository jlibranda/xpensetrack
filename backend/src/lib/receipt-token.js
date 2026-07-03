// src/lib/receipt-token.js
// Signs a long-lived, receipt-scoped token so an exported Excel can link straight
// to a single receipt without a login. The token only opens ITS OWN receipt and
// expires, so it can't be used to browse other receipts.
const jwt = require('jsonwebtoken');

function signReceiptToken(receiptId, expiresIn = '90d') {
  return jwt.sign({ rid: receiptId, purpose: 'receipt-view' }, process.env.JWT_SECRET, { expiresIn });
}

module.exports = { signReceiptToken };
