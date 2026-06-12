// src/routes/ocr.js
const router = require('express').Router();
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const prisma = new PrismaClient();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/scan', authenticate, upload.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    // Store receipt in DB
    const receipt = await prisma.receipt.create({
      data: { data: req.file.buffer, mimeType: req.file.mimetype || 'image/jpeg', filename: req.file.originalname || 'receipt' },
    });

    // AI parse with Anthropic
    let parsed = null;
    let aiUsed = false;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      try {
        const base64 = req.file.buffer.toString('base64');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64 } },
                { type: 'text', text: `You are a receipt parser. Extract data from this receipt image and return ONLY a valid JSON object with no other text, no markdown, no code blocks.

Return exactly this JSON structure:
{"title":"merchant or store name","amount":123.45,"currency":"PHP","date":"YYYY-MM-DD","category":"MEALS"}

Rules:
- title: merchant/store name from receipt
- amount: total amount as number only (no currency symbols, no commas)
- currency: "PHP" if peso signs or Philippine store, "USD" if dollar signs
- date: date from receipt in YYYY-MM-DD format, null if not found
- category: must be exactly one of: MEALS, TRAVEL, ACCOMMODATION, SUPPLIES, COMMUNICATIONS, OTHER

Return only the JSON object, nothing else.` }
              ],
            }],
          }),
        });

        if (response.ok) {
          const aiData = await response.json();
          const text = aiData.content?.[0]?.text?.trim() || '';
          console.log('AI response:', text);
          // Extract JSON from response
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            parsed = JSON.parse(match[0]);
            // Validate amount is a number
            if (parsed.amount && typeof parsed.amount === 'string') {
              parsed.amount = parseFloat(parsed.amount.replace(/[^0-9.]/g, ''));
            }
            aiUsed = true;
            console.log('AI parsed:', parsed);
          }
        } else {
          const errData = await response.json();
          console.error('Anthropic API error:', errData);
        }
      } catch(e) {
        console.error('AI parse error:', e.message);
      }
    } else {
      console.log('ANTHROPIC_API_KEY not set - skipping AI parse');
    }

    res.json({
      receiptId: receipt.id,
      parsed: parsed || { title:'', amount:null, currency:'PHP', date:null, category:'OTHER' },
      aiUsed,
    });
  } catch(err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'Receipt upload failed', message: err.message });
  }
});

router.get('/receipt/:id', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken');
    const token = (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null)
      || req.query.token;
    if (!token) return res.status(401).send('Unauthorized');
    jwt.verify(token, process.env.JWT_SECRET);
    const receipt = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!receipt) return res.status(404).send('Not found');
    res.setHeader('Content-Type', receipt.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(receipt.data);
  } catch(err) {
    res.status(500).send('Error');
  }
});

module.exports = router;
