// src/lib/notifications.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createNotification(userId, type, title, message, link) {
  try {
    await prisma.notification.create({
      data: { userId, type, title, message, link: link || null }
    });
  } catch(e) {
    console.error('Notification error:', e.message);
  }
}

module.exports = { createNotification };
