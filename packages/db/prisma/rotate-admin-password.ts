import bcrypt from 'bcrypt';

import { createPrismaClient } from '../src';

/** Rotate an existing admin's password. The 001-admin-user seed phase upserts
 *  with `update: {}` so it can never clobber a real user — which also means it
 *  can never rotate one. This is that missing path. */
async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi';
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error('ADMIN_PASSWORD must be set and at least 16 characters');
  }

  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const target = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!target) {
      // Restoring a local dump brings that machine's users across, so the admin
      // email on production is whatever it was locally (e.g. admin@capbase.dev).
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { email: true },
      });
      throw new Error(
        `No user with email "${email}". ADMIN users in this database: ` +
          (admins.map((a) => a.email).join(', ') || '(none)') +
          '\nRe-run with ADMIN_EMAIL set to one of them.',
      );
    }

    await prisma.user.update({
      where: { email },
      data: { passwordHash: await bcrypt.hash(password, 10), role: 'ADMIN' },
    });
    console.log(`Rotated password for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
