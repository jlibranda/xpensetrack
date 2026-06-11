// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/ocr/scan — upload receipt, store in DB, parse with AI
router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    // 1. Store receipt in DB
    const receipt = await prisma.receipt.create({
      data: {
        data: req.file.buffer,
        mimeType: req.file.mimetype || 'image/jpeg',
        filename: req.file.originalname || 'receipt',
      },
    });

    // 2. AI parse if Anthropic key available
    let parsed = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const base64 = req.file.buffer.toString('base64');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64 } },
                { type: 'text', text: `Extract receipt data. Return ONLY valid JSON, no other text:
{"title":"merchant name","amount":number_or_null,"currency":"PHP","date":"YYYY-MM-DD_or_null","category":"MEALS|TRAVEL|ACCOMMODATION|SUPPLIES|COMMUNICATIONS|OTHER"}
Default currency to PHP if unclear. Category must be one of the listed values.` }
              ],
            }],
          }),
        });
        if (response.ok) {
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text || '';
          const match = text.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
      } catch (e) { console.log('AI parse error:', e.message); }
    }

    res.json({
      receiptId: receipt.id,
      receiptUrl: `/api/ocr/receipt/${receipt.id}`,
      parsed: parsed || { title: '', amount: null, currency: 'PHP', date: null, category: 'OTHER' },
      aiUsed: !!parsed,
    });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'Receipt upload failed', message: err.message });
  }
});

// GET /api/ocr/receipt/:id — serve receipt image
router.get('/receipt/:id', authenticate, async (req, res) => {
  try {
    const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).json({ error: 'Receipt not found' });
    res.setHeader('Content-Type', receipt.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(receipt.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
