// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Pick the best matching system category for a set of keyword hints.
// Only ever returns a category that exists in the org's configured list.
function matchSystemCategory(systemCats, hints) {
  if (!systemCats || !systemCats.length) return null;
  const lc = systemCats.map(c => ({ raw: c, low: c.toLowerCase() }));
  for (const h of hints) {
    const found = lc.find(c => c.low.includes(h));
    if (found) return found.raw;
  }
  return null;
}

// Map a keyword group (from merchant/text) to hint words we search for inside
// the real system category names.
function categoryHints(text) {
  const s = (text || '').toLowerCase();
  if (/jollibee|mcdo|mcdonald|kfc|chowking|greenwich|mang inasal|max'?s|starbucks|coffee|cafe|tea|milk\s*tea|milktea|coco|juice|beverage|drink|smoothie|shake|snack|dessert|donut|bakery|bread|cake|restaurant|grill|kitchen|pizza|burger|chicken|bbq|barbecue|lechon|seafood|food|eatery|carinderia|canteen|deli|bistro|dining|meal|resto|fastfood|fast food/.test(s)) return ['meal', 'entertainment', 'food', 'dining'];
  if (/hotel|inn|resort|lodging|airbnb|motel|pension|hostel/.test(s)) return ['hotel', 'accommodation', 'lodging', 'travel - hotel'];
  if (/airline|flight|cebu pacific|philippine airlines|airasia|air ticket|boarding/.test(s)) return ['air ticket', 'air', 'flight', 'travel'];
  if (/grab|angkas|joyride|taxi|uber|lalamove|fare|toll|petron|shell|caltex|seaoil|gas|fuel|bus|jeepney|parking|transport/.test(s)) return ['travel - others', 'travel', 'parking', 'transport'];
  if (/globe|smart|pldt|converge|sky|dito|tnt|telecom|load|prepaid|internet|data|sim|mobile/.test(s)) return ['mobile', 'communication', 'phone', 'internet'];
  if (/office|supplies|stationery|national book|paper|ink|printing|print/.test(s)) return ['office', 'printing', 'supplies'];
  if (/hardware|ace hardware|wilcon|tools|equipment/.test(s)) return ['hardware', 'equipment', 'tools'];
  if (/cleaning|janitorial|sanitation/.test(s)) return ['cleaning'];
  if (/training|seminar|course|education/.test(s)) return ['education', 'training'];
  if (/furniture|fixture|chair|desk|table/.test(s)) return ['furniture', 'fixtures'];
  if (/rent|lease/.test(s)) return ['rent'];
  return [];
}

// Determine a SYSTEM category from the merchant name.
//  1) Search past expenses for the same merchant and reuse the category used most
//     often (these are already valid system categories).
//  2) Fall back to keyword hints mapped onto the org's configured categories.
// Never invents a category outside the system list.
async function categoryFromMerchant(merchant, systemCats) {
  const m = (merchant || '').trim();
  if (m.length < 3) return null;

  // --- 1) Learn from past expenses (already valid system categories) ---
  try {
    const keyword = m.split(/\s+/)[0];
    if (keyword.length >= 3) {
      const rows = await prisma.expense.findMany({
        where: { merchant: { contains: keyword, mode: 'insensitive' } },
        select: { category: true },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
      if (rows.length) {
        const counts = {};
        for (const r of rows) counts[r.category] = (counts[r.category] || 0) + 1;
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        // Only reuse it if it's still a valid system category.
        if (best && (!systemCats || systemCats.includes(best[0]))) return best[0];
      }
    }
  } catch (e) { console.error('merchant history lookup failed:', e.message); }

  // --- 2) Keyword hints mapped to real system categories ---
  const hinted = matchSystemCategory(systemCats, categoryHints(m));
  if (hinted) return hinted;

  // --- 3) Neutral fallback: a "miscellaneous"/"other"/"general" system category
  //        (so an undetected merchant doesn't default to whatever is first in the list).
  return matchSystemCategory(systemCats, ['miscellaneous', 'other', 'general office', 'general']);
}

const CATEGORIES = ['MEALS', 'TRAVEL', 'ACCOMMODATION', 'SUPPLIES', 'COMMUNICATIONS', 'OTHER'];

// Enhance a phone photo for better OCR: downscale (under the 1MB free-tier limit),
// convert to grayscale, and boost contrast. Returns a JPEG buffer, or null on failure.
async function preprocessImage(buffer) {
  try {
    const Jimp = require('jimp');
    const image = await Jimp.read(buffer);
    const maxDim = 2000;
    if (image.bitmap.width > maxDim || image.bitmap.height > maxDim) image.scaleToFit(maxDim, maxDim);
    image.greyscale().normalize().contrast(0.2);
    let quality = 80;
    let out = await image.clone().quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    // Keep under ~1MB for the OCR.space free tier.
    while (out.length > 1000000 && quality > 30) {
      quality -= 15;
      out = await image.clone().quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    }
    return out;
  } catch (e) {
    console.error('Image preprocess failed:', e.message);
    return null;
  }
}

// Parse raw OCR text (from OCR.space) into structured receipt fields.
function parseReceiptText(raw) {
  const text = raw.replace(/\r/g, '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const lower = text.toLowerCase();

  // --- Amount: prefer the value next to the strongest "total" keyword. ---
  const moneyRe = /(\d{1,3}(?:[,]\d{3})+(?:\.\d{2})?|\d+\.\d{2}|\d+\.\d{1})/;
  const moneyReG = new RegExp(moneyRe.source, 'g');
  let amount = null;

  const moneyIn = (s) => {
    const m = String(s).match(moneyReG);
    if (!m) return [];
    return m.map(v => parseFloat(v.replace(/,/g, ''))).filter(n => !isNaN(n) && n > 0);
  };

  // Keyword priority (highest first). We scan lines for these labels.
  const priorities = [
    /grand\s*total/i,
    /total\s*amount\s*due/i,
    /amount\s*due/i,
    /total\s*amount/i,
    /total\s*payment/i,
    /(?:net\s*)?total\s*sales?/i,
    /\btotal\b/i,
  ];
  // Lines that look like totals but are NOT the final amount — never use these.
  const exclude = /(sub\s*-?\s*total|vat(?:able)?|less|discount|change|tendered|cash|tax\b|exclusive|vat amount)/i;

  for (const kw of priorities) {
    if (amount != null) break;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!kw.test(l) || exclude.test(l)) continue;
      // Amount may be on the same line, or on the next line (common on receipts).
      let vals = moneyIn(l);
      if (!vals.length && i + 1 < lines.length) vals = moneyIn(lines[i + 1]);
      if (vals.length) { amount = Math.max(...vals); break; }
    }
  }

  // Last resort: largest money value anywhere (excluding obvious non-total lines).
  if (amount == null) {
    const candidates = lines.filter(l => !exclude.test(l)).flatMap(moneyIn);
    if (candidates.length) amount = Math.max(...candidates);
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
  // Search a comprehensive set of receipt-number labels in priority order.
  // The captured value MUST contain a digit (so plain words like "NORTH" are
  // never taken). Accepts the value on the same line or the next line.
  let orNumber = null;
  const orLabels = [
    /official\s*receipt\s*(?:no\.?|nbr\.?|number|#)?/i,
    /\bO\.?\s*R\.?\s*(?:no\.?|nbr\.?|number|#)?/i,        // OR, O.R., OR No, OR#
    /(?:sales?\s*invoice|charge\s*invoice|cash\s*invoice)\s*(?:no\.?|number|#)?/i,
    /\bS\.?\s*I\.?\s*(?:no\.?|number|#)?/i,                // SI, S.I., SI No, SI#
    /\bC\.?\s*I\.?\s*(?:no\.?|number|#)?/i,                // CI (Charge Invoice)
    /(?:collection|cash|provisional|acknowledgement|acknowledgment)\s*receipt\s*(?:no\.?|number|#)?/i,
    /\bC\.?\s*R\.?\s*(?:no\.?|number|#)?/i,                // CR (Collection/Cash Receipt)
    /invoice\s*(?:no\.?|number|#)?/i,
    /receipt\s*(?:no\.?|number|#)?/i,
    /(?:transaction|trans|txn|tran)\s*(?:no\.?|id|#)?/i,
    /(?:document|doc)\s*(?:no\.?|#)?/i,
    /(?:bill|check|chk|tab)\s*(?:no\.?|#)?/i,              // restaurant bill/check no
    /folio\s*(?:no\.?|#)?/i,                               // hotel folio
    /(?:order|ord)\s*(?:no\.?|#)?/i,
    /(?:slip|sequence|seq|trace)\s*(?:no\.?|#)?/i,
    /(?:reference|ref)\s*(?:no\.?|#)?/i,
    /(?:ticket|tkt)\s*(?:no\.?|#)?/i,
  ];

  // Labels that look numeric but are NOT the receipt number — never use the
  // value next to these (machine serials, BIR permits, TINs, terminal IDs, etc.).
  const orExcludeLabel = /(serial|machine|min\b|s\/?n\b|accredit|permit|birth|vat\s*reg|tin\b|terminal|pos\s*id|store\s*code|branch\s*code|atp\b|ptu\b)/i;

  // A plausible receipt-number token.
  const looksLikeRef = (v) => {
    if (!v) return false;
    const t = v.trim().replace(/^[:.#\-]+/, '').replace(/[)\].,;:]+$/, '');
    if (!/\d/.test(t)) return false;                 // must contain at least one digit
    if (t.length < 3 || t.length > 28) return false;
    if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t)) return false;       // a date
    if (/\d{1,2}:\d{2}/.test(t)) return false;                            // a time
    if (t.replace(/\D/g, '').length >= 10 && /^\+?[\d\s().-]+$/.test(t)) return false; // phone
    if (/^\d{3}-\d{3}-\d{3}(-\d{3,})?$/.test(t)) return false;            // a TIN
    if (/^(php|usd|p|\$)?[\d,]+\.\d{2}$/i.test(t)) return false;          // a money amount
    return /^[A-Za-z0-9][A-Za-z0-9\-/]*$/.test(t);
  };

  const cleanRef = (t) => t.trim().replace(/^[:.#\-]+/, '').replace(/[)\].,;:]+$/, '');

  outer:
  for (const label of orLabels) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (orExcludeLabel.test(l)) continue;          // skip serial/permit/TIN lines
      const m = l.match(label);
      if (!m) continue;
      // Value right after the label on the same line.
      const after = l.slice(m.index + m[0].length).replace(/^[:.#\s-]+/, '');
      const tokenSame = after.split(/\s{2,}|\s(?=[A-Za-z]{4,}\b)/)[0]?.trim();
      if (looksLikeRef(tokenSame)) { orNumber = cleanRef(tokenSame); break outer; }
      // Otherwise the first token on the next line.
      if (i + 1 < lines.length && !orExcludeLabel.test(lines[i + 1])) {
        const tokenNext = lines[i + 1].trim().split(/\s+/)[0];
        if (looksLikeRef(tokenNext)) { orNumber = cleanRef(tokenNext); break outer; }
      }
    }
  }

  // --- Merchant: first meaningful non-numeric line near the top ---
  let merchant = '';
  for (const l of lines.slice(0, 6)) {
    if (l.length >= 3 && !/^\d/.test(l) && !/receipt|invoice|official/i.test(l)) { merchant = l; break; }
  }

  // Category is resolved later against the system's configured list (via the
  // merchant lookup), so we don't emit an invented category here.
  return {
    merchant: merchant || '',
    title: merchant || '',
    orNumber: orNumber || '',
    amount: amount,
    currency,
    date,
    category: '',
  };
}

router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const receipt = await prisma.receipt.create({
      data: { data: req.file.buffer, mimeType: req.file.mimetype || 'image/jpeg', filename: req.file.originalname || 'receipt' },
    });

    // The org's configured category list — OCR must only ever pick from these.
    let systemCats = [];
    try {
      const org = await prisma.orgSettings.findFirst();
      systemCats = (org?.categories || '').split(',').map(s => s.trim()).filter(Boolean);
    } catch (e) { console.error('could not load categories:', e.message); }

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
              { type: 'text', text: `You are a receipt parser. Return ONLY a JSON object: {"merchant":"","title":"","orNumber":"","amount":123.45,"currency":"PHP","date":"YYYY-MM-DD","category":""}. The category MUST be exactly one of these (copy verbatim): ${systemCats.join(' | ')}. If unsure, leave category as "". Use null for missing date/orNumber. No markdown, JSON only.` },
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
        const mime = req.file.mimetype || 'image/jpeg';
        const isPdf = mime.includes('pdf') || (req.file.originalname || '').toLowerCase().endsWith('.pdf');
        // Enhance photos for better recognition (PDFs are sent as-is).
        let sendBuffer = req.file.buffer;
        let sendMime = mime;
        if (!isPdf) {
          const enhanced = await preprocessImage(req.file.buffer);
          if (enhanced) { sendBuffer = enhanced; sendMime = 'image/jpeg'; }
        }
        body.append('base64Image', `data:${sendMime};base64,${sendBuffer.toString('base64')}`);
        body.append('filetype', isPdf ? 'PDF' : 'Auto');
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

    // Resolve the category against the SYSTEM list only — never invent one.
    if (parsed) {
      // Drop any category that isn't a valid system category.
      if (parsed.category && systemCats.length && !systemCats.includes(parsed.category)) parsed.category = '';
      // If still unset, derive it from the merchant (history + keyword hints).
      if (!parsed.category && parsed.merchant) {
        try {
          const cat = await categoryFromMerchant(parsed.merchant, systemCats);
          if (cat) parsed.category = cat;
        } catch (e) { console.error('category lookup error:', e.message); }
      }
    }

    res.json({
      receiptId: receipt.id,
      parsed: parsed || { merchant:'', title:'', orNumber:'', amount:null, currency:'PHP', date:null, category:'' },
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
