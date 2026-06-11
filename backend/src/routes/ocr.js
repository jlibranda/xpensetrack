// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const vision = require('@google-cloud/vision');
const cloudinary = require('cloudinary').v2;
const { authenticate } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const client = new vision.ImageAnnotatorClient({ apiKey: process.env.GOOGLE_VISION_API_KEY });

cloudinary.config({ secure: true }); // uses CLOUDINARY_URL env var

// POST /api/ocr/scan  — upload receipt image, return parsed fields
router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    // 1. Run OCR
    const [result] = await client.textDetection({ image: { content: req.file.buffer } });
    const fullText = result.fullTextAnnotation?.text || '';

    // 2. Upload to Cloudinary
    const uploaded = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: 'xpensetrack/receipts', resource_type: 'image' },
        (err, result) => err ? reject(err) : resolve(result)
      ).end(req.file.buffer);
    });

    // 3. Parse common fields from OCR text
    const parsed = parseReceiptText(fullText);

    res.json({
      receiptUrl: uploaded.secure_url,
      receiptData: fullText,
      parsed,
    });
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'OCR processing failed', message: err.message });
  }
});

function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Amount — look for patterns like "TOTAL 1,250.00" or "₱3,500"
  const amountMatch = text.match(/(?:total|amount|subtotal)[:\s]*[₱$]?\s*([\d,]+\.?\d*)/i)
    || text.match(/[₱$]\s*([\d,]+\.?\d*)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  // Currency
  const currency = text.includes('₱') || text.toLowerCase().includes('php') ? 'PHP'
    : text.includes('$') || text.toLowerCase().includes('usd') ? 'USD' : 'PHP';

  // Date — common Philippine date formats
  const dateMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  let date = null;
  if (dateMatch) {
    const [, m, d, y] = dateMatch;
    date = `${y.length === 2 ? '20' + y : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Merchant name — usually one of the first lines
  const title = lines[0] || '';

  // Category hints
  const lower = text.toLowerCase();
  let category = 'OTHER';
  if (/restaurant|cafe|food|dining|kain|makan/.test(lower)) category = 'MEALS';
  else if (/hotel|inn|lodge|accommodation|room/.test(lower)) category = 'ACCOMMODATION';
  else if (/grab|taxi|uber|airline|flight|bus|train|fuel|gas/.test(lower)) category = 'TRAVEL';
  else if (/office|supplies|stationery|printer/.test(lower)) category = 'SUPPLIES';
  else if (/globe|smart|pldt|internet|phone|mobile/.test(lower)) category = 'COMMUNICATIONS';

  return { title, amount, currency, date, category };
}

module.exports = router;
