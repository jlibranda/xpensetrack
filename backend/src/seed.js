// First-run seed: creates the initial ADMIN account so the company can log in on a
// fresh database. Safe to run repeatedly (idempotent). Configure via env vars:
//   SEED_ADMIN_EMAIL     (default: admin@company.com)
//   SEED_ADMIN_PASSWORD  (default: ChangeMe123!)  -> user is forced to change it on first login
//   SEED_ADMIN_FIRSTNAME (default: System)
//   SEED_ADMIN_LASTNAME  (default: Administrator)
// Run once after the database is up:  npm run db:seed
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@company.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const firstName = process.env.SEED_ADMIN_FIRSTNAME || 'System';
  const lastName = process.env.SEED_ADMIN_LASTNAME || 'Administrator';

  // Ensure an OrgSettings row exists (the app also auto-creates one, but do it here too).
  const settings = await prisma.orgSettings.findFirst();
  if (!settings) {
    await prisma.orgSettings.create({ data: { companyName: process.env.SEED_COMPANY_NAME || 'My Company' } });
    console.log('✓ Created default OrgSettings');
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN' || !existing.isActive) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', isActive: true } });
      console.log(`✓ Existing user ${email} promoted to ADMIN`);
    } else {
      console.log(`✓ Admin ${email} already exists — nothing to do`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { email, firstName, lastName, passwordHash, role: 'ADMIN', isActive: true, mustChangePassword: true },
  });
  console.log('==================================================');
  console.log('✓ First ADMIN account created');
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}   (must be changed on first login)`);
  console.log('==================================================');
}

main()
  .catch((e) => { console.error('Seed failed:', e.message); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
