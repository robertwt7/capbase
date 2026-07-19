import bcrypt from 'bcrypt';

import type { Seed } from './types';

/** Bootstrap: the moderation admin every environment needs. Upserts by email
 *  and never touches an existing user's credentials. */
export const adminUser: Seed = {
  name: '001-admin-user',
  kind: 'bootstrap',
  async run(prisma) {
    const email = process.env.ADMIN_EMAIL ?? 'admin@capbase.fyi';
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: process.env.ADMIN_NAME ?? 'Capbase Admin',
        passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD ?? 'admin12345', 10),
        role: 'ADMIN',
      },
    });
  },
};
