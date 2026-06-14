// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const CATEGORIES = ['MEALS', 'TRAVEL', 'ACCOMMODATION', 'SUPPLIES', 'COMMUNICATIONS', 'OTHER'];

// Parse raw OCR text (from OCR.space) into structured receipt fields.
function parseReceiptText(raw) {
  const text = raw.replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  // --- Amount: prefer a line mentioning total/amount due; else the largest money value ---
  const moneyRe = /(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\d+\.\d{2})/g;
  let amount = null;
  const totalLine = lines.find(l => /(grand\s*total|amount\s*due|total\s*amount|total)/i.test(l) && moneyRe.test(l));
  const pick = (s) => {
    const m = String(s).match(moneyRe);
    if (!m) return null;
    return m.map(v => parseFloat(v.replace(/[,\s]/g, ''))).filter(n => !isNaN(n));
  };
  if (totalLine) {
    const vals = pick(totalLine);
    if (vals && vals.length) amount = Math.max(...vals);
  }
  if (amount == null) {
    const all = pick(text) || [];
    if (all.length) amount = Math.max(...all); // best-effort: largest money figure
  }

  // --- Currency ---
  let currency = 'PHP';
  if (/\$|usd|dollar/i.test(lower) && !/php|peso|₱/i.test(lower)) currency = 'USD';

  // --- Date: try common formats, normalize to YYYY-MM-DD ---
  let date = null;
  const isoM = text.match(/(20\d{2})[-/](\d{1,2})[-/](\d{1,2})/);
  const slashM = text.match(/(\d{1,2})[-/](\d{1,2})[-/](20\d{2})/);
  const monM = text.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  const pad = (n) => String(n).padStart(2, '0');
  if (isoM) date = `${isoM[1]}-${pad(isoM[2])}-${pad(isoM[3])}`;
  else if (slashM) {
    // Receipts here are typically MM/DD/YYYY. If the first part is >12 it must be the day.
    let a = parseInt(slashM[1], 10), b = parseInt(slashM[2], 10);
    let month, day;
    if (a > 12) { day = a; month = b; }       // DD/MM/YYYY
    else if (b > 12) { month = a; day = b; }   // MM/DD/YYYY (day > 12 confirms)
    else { month = a; day = b; }               // ambiguous -> assume MM/DD/YYYY
    date = `${slashM[3]}-${pad(month)}-${pad(day)}`;
  }
  else if (monM) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mo = months[monM[1].toLowerCase().slice(0,3)];
    if (mo) date = `${monM[3]}-${pad(mo)}-${pad(monM[2])}`;
  }

  // --- OR / receipt number ---
  let orNumber = null;
  const orM = text.match(/(?:OR\s*(?:No|Number|#)?|Invoice\s*(?:No|#)?|Receipt\s*(?:No|#)?|TXN|Ref(?:erence)?\s*(?:No|#)?)\s*[:.#]?\s*([A-Za-z0-9\-]{3,})/i);
  if (orM) orNumber = orM[1];

  // --- Merchant: first meaningful non-numeric line near the top ---
  let merchant = '';
  for (const l of lines.slice(0, 6)) {
    if (l.length >= 3 && !/^\d/.test(l) && !/receipt|invoice|official/i.test(l)) { merchant = l; break; }
  }

  // --- Category guess from keywords ---
  let category = 'OTHER';
  if (/restaurant|cafe|coffee|food|grill|kitchen|jollibee|mcdo|grocery|mart|store/i.test(lower)) category = 'MEALS';
  else if (/hotel|inn|resort|lodging/i.test(lower)) category = 'ACCOMMODATION';
  else if (/grab|taxi|fare|toll|gas|fuel|petron|shell|airline|ticket/i.test(lower)) category = 'TRAVEL';
  else if (/office|supplies|stationery|paper|ink/i.test(lower)) category = 'SUPPLIES';
  else if (/load|prepaid|telecom|globe|smart|internet|data/i.test(lower)) category = 'COMMUNICATIONS';

  return {
    merchant: merchant || '',
    title: merchant || '',
    orNumber: orNumber || '',
    amount: amount,
    currency,
    date,
    category: CATEGORIES.includes(category) ? category : 'OTHER',
  };
}

router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const receipt = await prisma.receipt.create({
      data: { data: req.file.buffer, mimeType: req.file.mimetype || 'image/jpeg', filename: req.file.originalname || 'receipt' },
    });

    let parsed = null;
    let aiUsed = false;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const ocrSpaceKey = process.env.OCRSPACE_API_KEY;

    // Preferred: Anthropic (structured) if configured.
    if (anthropicKey) {
      try {
        const base64 = req.file.buffer.toString('base64');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{ role: 'user', content: [
              { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64 } },
              { type: 'text', text: 'You are a receipt parser. Return ONLY a JSON object: {"merchant":"","title":"","orNumber":"","amount":123.45,"currency":"PHP","date":"YYYY-MM-DD","category":"MEALS"}. category is one of MEALS, TRAVEL, ACCOMMODATION, SUPPLIES, COMMUNICATIONS, OTHER. Use null for missing date/orNumber. No markdown, JSON only.' },
            ] }],
          }),
        });
        if (response.ok) {
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text?.trim() || '';
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
            if (parsed.amount && typeof parsed.amount === 'string') parsed.amount = parseFloat(parsed.amount.replace(/[^0-9.]/g, ''));
            aiUsed = true;
          }
        } else { console.error('Anthropic API error:', await response.text()); }
      } catch (e) { console.error('Anthropic parse error:', e.message); }
    }

    // Fallback: OCR.space (free). Returns raw text; we parse it into fields.
    if (!parsed && ocrSpaceKey) {
      try {
        const body = new URLSearchParams();
        body.append('base64Image', `data:${req.file.mimetype || 'image/jpeg'};base64,${req.file.buffer.toString('base64')}`);
        body.append('OCREngine', '2');
        body.append('scale', 'true');
        body.append('isTable', 'true');
        const ocrRes = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', apikey: ocrSpaceKey },
          body,
        });
        const ocrData = await ocrRes.json();
        const rawText = ocrData?.ParsedResults?.[0]?.ParsedText || '';
        if (rawText) {
          parsed = parseReceiptText(rawText);
          aiUsed = true;
        } else {
          console.error('OCR.space no text:', ocrData?.ErrorMessage || ocrData?.OCRExitCode);
        }
      } catch (e) { console.error('OCR.space error:', e.message); }
    }

    if (!anthropicKey && !ocrSpaceKey) console.log('No OCR key set - skipping parse');

    res.json({
      receiptId: receipt.id,
      parsed: parsed || { merchant:'', title:'', orNumber:'', amount:null, currency:'PHP', date:null, category:'OTHER' },
      aiUsed,
    });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'Receipt upload failed', message: err.message });
  }
});

router.get('/receipt/:id', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const token = (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null) || req.query.token;
    if (!token) return res.status(401).send('Unauthorized');
    jwt.verify(token, process.env.JWT_SECRET);
    const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).send('Not found');
    res.setHeader('Content-Type', receipt.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(receipt.data);
  } catch (err) {
    res.status(500).send('Error');
  }
});

module.exports = router;
