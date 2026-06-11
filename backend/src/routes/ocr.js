// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/ocr/scan — upload receipt image, use AI to parse
router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype || 'image/jpeg';

    // Use Anthropic Claude API to parse receipt
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: `Extract information from this receipt image and return ONLY a JSON object with these fields (no other text):
{
  "title": "merchant/store name",
  "amount": number (total amount, numbers only),
  "currency": "PHP" or "USD",
  "date": "YYYY-MM-DD format",
  "category": one of: MEALS, TRAVEL, ACCOMMODATION, SUPPLIES, COMMUNICATIONS, OTHER
}
If a field cannot be determined, use null. For currency, default to PHP if unclear.`,
            },
          ],
        }],
      }),
    });

    let parsed = null;
    let receiptUrl = null;

    if (response.ok) {
      const aiData = await response.json();
      const text = aiData.content?.[0]?.text || '';
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (e) { /* ignore parse error */ }
    }

    // Store receipt as base64 data URL (no Cloudinary needed)
    receiptUrl = `data:${mediaType};base64,${base64}`;

    res.json({ receiptUrl, parsed: parsed || fallbackParse('') });
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'Receipt processing failed', message: err.message });
  }
});

function fallbackParse(text) {
  return { title: '', amount: null, currency: 'PHP', date: null, category: 'OTHER' };
}

module.exports = router;
