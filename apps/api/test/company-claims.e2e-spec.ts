import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import request from 'supertest';

import {
  CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY,
  CLAIM_ATTEMPTS_PER_USER_PER_DAY,
  CLAIM_DOMAIN_MISMATCH,
  CLAIM_EMAIL_UNAVAILABLE,
} from '@repo/api';

import { MergeService } from '../src/admin/merge/merge.service';
import { activeClaimIds, isActiveClaim } from '../src/claims/active-claim';
import { ClaimsService } from '../src/claims/claims.service';
import { MailService } from '../src/mail/mail.service';
import { UsersService } from '../src/users/users.service';
import { featureFixtures } from './feature-fixtures';

// Company claims: the email flow, its limits, the end states and merges. Users through Prisma,
// no /auth calls; the mail provider is faked so the suite can read the link it would send.
describe('Company claims (e2e)', () => {
  let f: Awaited<ReturnType<typeof featureFixtures>>;
  let claims: ClaimsService;
  const sent: { to: string; company: string; link: string }[] = [];
  const notices: { to: string; event: string }[] = [];
  const createdClaimIds: string[] = [];
  const mergeRecordIds: string[] = [];
  const candidateIds: string[] = [];

  const mail = {
    sendClaimVerify: jest.fn(async (to: string, company: string, link: string) => {
      sent.push({ to, company, link });
    }),
    sendClaimNotice: jest.fn(async (to: string, _name: string, _company: string, event: string) => {
      notices.push({ to, event });
    }),
    sendSubmissionApprovedEmail: jest.fn(async () => {}),
    sendSubmissionRejectedEmail: jest.fn(async () => {}),
    sendSecurityNotice: jest.fn(async () => {}),
    sendVerificationEmail: jest.fn(async () => {}),
  };

  const http = () => request(f.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** A unique, claimable domain per call (parallel suites never collide). */
  let seq = 0;
  const domain = () => `claims-${Date.now().toString(36)}-${seq++}.example.org`;
  const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

  /** Start a claim over HTTP and return the token the email would have carried. */
  const start = async (token: string, slug: string, email: string) => {
    const before = sent.length;
    await http()
      .post(`/companies/${slug}/claim/email`)
      .set(auth(token))
      .send({ email, authorised: true })
      .expect(200, { ok: true });
    expect(sent.length).toBe(before + 1);
    return tokenOf(sent[sent.length - 1]!.link);
  };

  /** Skip the cooldown: age the user's tokens so the next start is allowed. */
  const age = (userId: string, ms = 120_000) =>
    f.prisma.$executeRaw`UPDATE "CompanyClaimToken" SET "createdAt" = "createdAt" - (${ms} * interval '1 millisecond') WHERE "userId" = ${userId}`;

  const claimFor = async (userId: string, companyId: string) => {
    const row = await f.prisma.companyClaim.findFirst({
      where: { userId, companyId },
      orderBy: { createdAt: 'desc' },
    });
    if (row) createdClaimIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    f = await featureFixtures((b) => {
      b.overrideProvider(MailService).useValue(mail);
    });
    claims = f.app.get(ClaimsService);
  }, 60_000);

  afterAll(async () => {
    if (mergeRecordIds.length) {
      await f.prisma.mergeRecord.deleteMany({ where: { id: { in: mergeRecordIds } } });
    }
    if (candidateIds.length) {
      await f.prisma.mergeCandidate.deleteMany({ where: { id: { in: candidateIds } } });
    }
    // Claims and tokens cascade with their users and companies.
    await f.close();
  }, 60_000);

  describe('starting a claim', () => {
    it('refuses every address the domain rule rejects, without revealing the domain', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      for (const email of [
        `jane@notx${host}`,
        `jane@${host}.evil.io`,
        `jane@gmail.com`,
        `jane@${host.replace('.example.org', '.example.com')}`,
      ]) {
        const res = await http()
          .post(`/companies/${co.slug}/claim/email`)
          .set(auth(u.token))
          .send({ email, authorised: true })
          .expect(400);
        expect(res.body.code).toBe(CLAIM_DOMAIN_MISMATCH);
        expect(JSON.stringify(res.body)).not.toContain(host);
      }
      expect(await f.prisma.companyClaimToken.count({ where: { userId: u.id } })).toBe(0);
    });

    it('refuses the parent of a stored subdomain', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: `shop.${host}` });
      const res = await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(u.token))
        .send({ email: `jane@${host}`, authorised: true })
        .expect(400);
      expect(res.body.code).toBe(CLAIM_DOMAIN_MISMATCH);
    });

    it('accepts a subdomain of the stored host', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await start(u.token, co.slug, `jane@eu.${host}`);
    });

    it.each(['', 'gmail.com', 'medium.com', 'linkedin.com', 'co.uk', 'github.io'])(
      'a company on "%s" cannot be claimed by email',
      async (stored) => {
        const u = await f.user('USER');
        const co = await f.company({ domain: stored });
        const res = await http()
          .post(`/companies/${co.slug}/claim/email`)
          .set(auth(u.token))
          .send({ email: `jane@${stored || 'acme.com'}`, authorised: true })
          .expect(400);
        expect(res.body.code).toBe(CLAIM_EMAIL_UNAVAILABLE);
        const view = await http().get(`/companies/${co.slug}/claim`).set(auth(u.token)).expect(200);
        expect(view.body.emailClaim).toBe(false);
      },
    );

    it('needs a verified account email, the attestation, and a public company', async () => {
      const u = await f.user('USER');
      await f.prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: null } });
      const host = domain();
      const co = await f.company({ domain: host });
      const res = await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(u.token))
        .send({ email: `jane@${host}`, authorised: true })
        .expect(403);
      expect(res.body.code).toBe('EMAIL_UNVERIFIED');

      const v = await f.user('USER');
      await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(v.token))
        .send({ email: `jane@${host}` })
        .expect(400);

      const pending = await f.company({ domain: domain(), moderationStatus: 'PENDING' });
      await http()
        .post(`/companies/${pending.slug}/claim/email`)
        .set(auth(v.token))
        .send({ email: `jane@${pending.domain}`, authorised: true })
        .expect(404);
      await http().get(`/companies/${pending.slug}/claim`).set(auth(v.token)).expect(404);
      await http().get(`/companies/${co.slug}/claim`).expect(401);
    });

    it('never sends the stored domain in the claim view, even for a partner-only company', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host, partnerOnly: true, partnerFields: ['domain'] });
      const res = await http().get(`/companies/${co.slug}/claim`).set(auth(u.token)).expect(200);
      expect(res.body.emailClaim).toBe(true);
      expect(res.body.company).toEqual({ slug: co.slug, name: co.name });
      expect(JSON.stringify(res.body)).not.toContain(host);
    });
  });

  describe('limits', () => {
    it('enforces the cooldown and the per-user daily count', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await start(u.token, co.slug, `a@${host}`);
      await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(u.token))
        .send({ email: `a@${host}`, authorised: true })
        .expect(429);
      for (let i = 1; i < CLAIM_ATTEMPTS_PER_USER_PER_DAY; i++) {
        await age(u.id);
        await start(u.token, co.slug, `a@${host}`);
      }
      await age(u.id);
      await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(u.token))
        .send({ email: `a@${host}`, authorised: true })
        .expect(429);
      // Superseded links are expired, not deleted — they are the counter.
      const rows = await f.prisma.companyClaimToken.findMany({ where: { userId: u.id } });
      expect(rows).toHaveLength(CLAIM_ATTEMPTS_PER_USER_PER_DAY);
      expect(rows.filter((r) => r.expiresAt > new Date())).toHaveLength(1);
    });

    it('enforces the per-company daily count across accounts', async () => {
      const host = domain();
      const co = await f.company({ domain: host });
      for (let i = 0; i < CLAIM_ATTEMPTS_PER_COMPANY_PER_DAY; i++) {
        const u = await f.user('USER');
        await start(u.token, co.slug, `p${i}@${host}`);
      }
      const late = await f.user('USER');
      await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(late.token))
        .send({ email: `late@${host}`, authorised: true })
        .expect(429);
    });
  });

  describe('spending a link', () => {
    it('works once, then refuses a replay', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      const token = await start(u.token, co.slug, `jane@${host}`);
      const res = await http().post('/claims/verify').send({ token }).expect(200);
      expect(res.body).toEqual({ companySlug: co.slug, companyName: co.name });
      await http().post('/claims/verify').send({ token }).expect(400);

      const claim = await claimFor(u.id, co.id);
      expect(claim).toMatchObject({ method: 'EMAIL', email: `jane@${host}`, domain: host });
      expect(claim!.verifiedAt).not.toBeNull();
      expect(notices.some((n) => n.to === u.email)).toBe(true);

      // A second link while already active is refused up front.
      await age(u.id);
      await http()
        .post(`/companies/${co.slug}/claim/email`)
        .set(auth(u.token))
        .send({ email: `jane@${host}`, authorised: true })
        .expect(409);

      const mine = await http().get('/auth/me/claims').set(auth(u.token)).expect(200);
      expect(mine.body).toEqual([
        expect.objectContaining({ companySlug: co.slug, status: 'active', method: 'EMAIL' }),
      ]);
    });

    it('refuses an expired link, a banned user, a re-domained or merged company', async () => {
      const host = domain();
      const co = await f.company({ domain: host });

      const expired = await f.user('USER');
      const t1 = await start(expired.token, co.slug, `e@${host}`);
      await f.prisma.companyClaimToken.updateMany({
        where: { userId: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expect(claims.verify(t1)).rejects.toThrow(/invalid, expired/);

      const banned = await f.user('USER');
      const t2 = await start(banned.token, co.slug, `b@${host}`);
      await f.prisma.user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
      await expect(claims.verify(t2)).rejects.toThrow(/invalid, expired/);

      const redomained = await f.user('USER');
      const t3 = await start(redomained.token, co.slug, `r@${host}`);
      await f.prisma.company.update({ where: { id: co.id }, data: { domain: domain() } });
      await expect(claims.verify(t3)).rejects.toThrow(/invalid, expired/);

      const host2 = domain();
      const loser = await f.company({ domain: host2 });
      const survivor = await f.company({ domain: host2 });
      const merged = await f.user('USER');
      const t4 = await start(merged.token, loser.slug, `m@${host2}`);
      await f.prisma.company.update({ where: { id: loser.id }, data: { mergedIntoId: survivor.id } });
      await expect(claims.verify(t4)).rejects.toThrow(/invalid, expired/);

      expect(
        await f.prisma.companyClaim.count({
          where: { userId: { in: [expired.id, banned.id, redomained.id, merged.id] } },
        }),
      ).toBe(0);
    });

    it('lets two users claim the same company; both are active', async () => {
      const host = domain();
      const co = await f.company({ domain: host });
      const a = await f.user('USER');
      const b = await f.user('USER');
      await claims.verify(await start(a.token, co.slug, `a@${host}`));
      await claims.verify(await start(b.token, co.slug, `b@${host}`));
      const rows = await f.prisma.companyClaim.findMany({
        where: { companyId: co.id },
        include: { user: true, company: true },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => isActiveClaim(r, r.company))).toBe(true);
    });
  });

  describe('the read gate', () => {
    it('an active claim does not unlock a user with no approved contribution', async () => {
      const admin = await f.user('ADMIN');
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      const users = f.app.get(UsersService);
      const before = await users.accessFor({ id: u.id, role: 'USER' });
      const detailBefore = await http().get(`/admin/users/${u.id}`).set(auth(admin.token)).expect(200);

      await claims.verify(await start(u.token, co.slug, `jane@${host}`));

      const after = await users.accessFor({ id: u.id, role: 'USER' });
      expect(after.unlocked).toBe(false);
      expect(after).toEqual(before);
      const detailAfter = await http().get(`/admin/users/${u.id}`).set(auth(admin.token)).expect(200);
      expect(detailAfter.body.access).toEqual(detailBefore.body.access);
      expect(detailAfter.body.claims).toEqual([
        expect.objectContaining({ companySlug: co.slug, status: 'active', userId: u.id }),
      ]);
      expect(detailAfter.body.claimCount).toBe(1);
    });
  });

  describe('ending a claim', () => {
    it('a ban revokes the claim and kills unused links; unbanning restores nothing', async () => {
      const admin = await f.user('ADMIN');
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      const other = await f.company({ domain: domain() });
      await claims.verify(await start(u.token, co.slug, `jane@${host}`));
      await age(u.id);
      const pendingLink = await start(u.token, other.slug, `jane@${other.domain}`);

      await http().patch(`/admin/users/${u.id}`).set(auth(admin.token)).send({ banned: true }).expect(200);
      const claim = await claimFor(u.id, co.id);
      expect(claim).toMatchObject({ endReason: 'ban', revokedById: admin.id });
      expect(claim!.revokedAt).not.toBeNull();

      await http().patch(`/admin/users/${u.id}`).set(auth(admin.token)).send({ banned: false }).expect(200);
      await expect(claims.verify(pendingLink)).rejects.toThrow(/invalid, expired/);
      expect((await claimFor(u.id, co.id))!.revokedAt).not.toBeNull();
    });

    it('the owner withdraws; another user gets a 404', async () => {
      const u = await f.user('USER');
      const stranger = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(u.token, co.slug, `jane@${host}`));
      const claim = (await claimFor(u.id, co.id))!;
      await http().delete(`/auth/me/claims/${claim.id}`).set(auth(stranger.token)).expect(404);
      const res = await http().delete(`/auth/me/claims/${claim.id}`).set(auth(u.token)).expect(200);
      expect(res.body).toMatchObject({ status: 'ended', endReason: 'withdrawn' });
    });

    it('an admin revokes, and the owner is told', async () => {
      const admin = await f.user('ADMIN');
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(u.token, co.slug, `jane@${host}`));
      const claim = (await claimFor(u.id, co.id))!;
      await http().post(`/admin/claims/${claim.id}/revoke`).set(auth(u.token)).expect(403);
      const res = await http()
        .post(`/admin/claims/${claim.id}/revoke`)
        .set(auth(admin.token))
        .expect(201);
      expect(res.body).toMatchObject({ status: 'ended', endReason: 'revoked', revokedBy: admin.name });
      expect(notices.filter((n) => n.to === u.email)).toHaveLength(2);
    });

    it('a domain change suspends an email claim; restoring the domain restores it', async () => {
      const u = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(u.token, co.slug, `jane@${host}`));
      const id = (await claimFor(u.id, co.id))!.id;
      expect(await activeClaimIds(f.prisma)).toContain(id);
      await f.prisma.company.update({ where: { id: co.id }, data: { domain: domain() } });
      expect(await activeClaimIds(f.prisma)).not.toContain(id);
      const mine = await http().get('/auth/me/claims').set(auth(u.token)).expect(200);
      expect(mine.body[0]).toMatchObject({ status: 'suspended' });
      await f.prisma.company.update({ where: { id: co.id }, data: { domain: `https://www.${host}/` } });
      expect(await activeClaimIds(f.prisma)).toContain(id);
    });
  });

  describe('merges', () => {
    it('a claim follows the survivor and returns on unmerge', async () => {
      const admin = await f.user('ADMIN');
      const u = await f.user('USER');
      const host = domain();
      const loser = await f.company({ domain: host });
      const survivor = await f.company({ domain: host });
      await claims.verify(await start(u.token, loser.slug, `jane@${host}`));
      const claim = (await claimFor(u.id, loser.id))!;

      const merges = f.app.get(MergeService);
      const candidate = await merges.createCandidate('company', loser.id, survivor.id);
      candidateIds.push(candidate.id);
      const merged = await merges.mergeCandidate(candidate.id, survivor.id, admin.id);
      mergeRecordIds.push(merged.mergeRecordId);
      const moved = await f.prisma.companyClaim.findUniqueOrThrow({
        where: { id: claim.id },
        include: { user: true, company: true },
      });
      expect(moved.companyId).toBe(survivor.id);
      expect(isActiveClaim(moved, moved.company)).toBe(true);

      await merges.unmerge(merged.mergeRecordId, admin.id);
      const back = await f.prisma.companyClaim.findUniqueOrThrow({ where: { id: claim.id } });
      expect(back.companyId).toBe(loser.id);
    });
  });

  describe('queue label, filter and history attribution', () => {
    const round = { name: 'Seed', date: '2025-06-01', amountUsd: 2_000_000, investors: [], attested: true };
    const submitRound = async (token: string, slug: string) =>
      (await http().post(`/companies/${slug}/rounds`).set(auth(token)).send(round).expect(201)).body
        .id as string;
    const submitEdit = async (token: string, slug: string, changes: Record<string, unknown>) =>
      (
        await http()
          .post(`/companies/${slug}/proposals`)
          .set(auth(token))
          .send({ changes, attested: true })
          .expect(201)
      ).body.id as string;
    type Item = { type: string; id: string; representative: boolean };
    const queue = async (admin: string, query: Record<string, string>) => {
      const res = await http()
        .get(`/admin/submissions?${new URLSearchParams({ status: 'PENDING', ...query })}`)
        .set(auth(admin))
        .expect(200);
      return res.body as { total: number; countsByType: Record<string, number>; items: Item[] };
    };
    const labelled = (items: Item[], id: string) => items.find((i) => i.id === id)?.representative;
    const decide = (admin: string, type: string, id: string, status: 'APPROVED' | 'REJECTED') =>
      http().patch(`/admin/submissions/${type}/${id}`).set(auth(admin)).send({ status }).expect(200);

    it('labels a representative\'s submissions, filters to them, and the counts agree', async () => {
      const admin = await f.user('ADMIN');
      const rep = await f.user('USER');
      const other = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });

      // Submitted before the claim: labelled once the claim verifies.
      const early = await submitRound(rep.token, co.slug);
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));
      const claim = (await claimFor(rep.id, co.id))!;
      expect((await f.prisma.fundingRound.findUnique({ where: { id: early } }))!.claimId).toBe(claim.id);

      const edit = await submitEdit(rep.token, co.slug, { headcount: 42 });
      const roundId = await submitRound(rep.token, co.slug);
      const theirs = await submitRound(other.token, co.slug);

      const mine = await queue(admin.token, { user: rep.id });
      expect(labelled(mine.items, edit)).toBe(true);
      expect(labelled(mine.items, roundId)).toBe(true);
      expect(labelled(mine.items, early)).toBe(true);
      const notMine = await queue(admin.token, { user: other.id });
      expect(labelled(notMine.items, theirs)).toBe(false);

      const filtered = await queue(admin.token, { user: rep.id, representative: '1' });
      expect(filtered.items.map((i) => i.id).sort()).toEqual([early, edit, roundId].sort());
      expect(filtered.items.every((i) => i.representative)).toBe(true);
      expect(filtered.total).toBe(3);
      expect(filtered.countsByType).toMatchObject({ round: 2, proposal: 1, company: 0, investorProposal: 0 });
      expect((await queue(admin.token, { user: other.id, representative: '1' })).total).toBe(0);

      // Revoke: the label goes and the rows leave the filter on the next read.
      await http().post(`/admin/claims/${claim.id}/revoke`).set(auth(admin.token)).expect(201);
      const after = await queue(admin.token, { user: rep.id });
      expect(after.items.some((i) => i.representative)).toBe(false);
      expect((await queue(admin.token, { user: rep.id, representative: '1' })).total).toBe(0);
    });

    it('a ban removes the label', async () => {
      const admin = await f.user('ADMIN');
      const rep = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));
      const roundId = await submitRound(rep.token, co.slug);
      expect(labelled((await queue(admin.token, { user: rep.id })).items, roundId)).toBe(true);
      await http().patch(`/admin/users/${rep.id}`).set(auth(admin.token)).send({ banned: true }).expect(200);
      // The ban sweep rejected the row; it is labelled nowhere.
      const rejected = await queue(admin.token, { user: rep.id, status: 'REJECTED' });
      expect(labelled(rejected.items, roundId)).toBe(false);
      expect((await queue(admin.token, { user: rep.id, status: 'REJECTED', representative: '1' })).total).toBe(0);
    });

    it("someone else's approved domain edit suspends the label; retracting it restores it", async () => {
      const admin = await f.user('ADMIN');
      const rep = await f.user('USER');
      const other = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));
      const roundId = await submitRound(rep.token, co.slug);

      const domainEdit = await submitEdit(other.token, co.slug, { domain: domain() });
      await decide(admin.token, 'proposal', domainEdit, 'APPROVED');
      expect(labelled((await queue(admin.token, { user: rep.id })).items, roundId)).toBe(false);

      await decide(admin.token, 'proposal', domainEdit, 'REJECTED'); // a retraction
      expect((await f.prisma.company.findUnique({ where: { id: co.id } }))!.domain).toBe(host);
      expect(labelled((await queue(admin.token, { user: rep.id })).items, roundId)).toBe(true);
    });

    it('an approval writes representative revisions only while the claim is active', async () => {
      const admin = await f.user('ADMIN');
      const rep = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));
      const claim = (await claimFor(rep.id, co.id))!;
      const edit = await submitEdit(rep.token, co.slug, { headcount: 77 });
      const roundId = await submitRound(rep.token, co.slug);
      const late = await submitRound(rep.token, co.slug);

      await decide(admin.token, 'proposal', edit, 'APPROVED');
      await decide(admin.token, 'round', roundId, 'APPROVED');
      await http().post(`/admin/claims/${claim.id}/revoke`).set(auth(admin.token)).expect(201);
      await decide(admin.token, 'round', late, 'APPROVED');

      const history = await http()
        .get(`/companies/${co.slug}/history?pageSize=50`)
        .set(auth(admin.token))
        .expect(200);
      const items = history.body.items as {
        entityId: string;
        field: string;
        action: string;
        representative: boolean;
        actorName: string | null;
      }[];
      const byEntity = (id: string, field = '') =>
        items.find((i) => i.entityId === id && i.field === field && i.action !== 'RETRACT');
      expect(byEntity(co.id, 'headcount')).toMatchObject({ representative: true, actorName: admin.name });
      expect(byEntity(roundId)).toMatchObject({ action: 'CREATE', representative: true });
      expect(byEntity(late)).toMatchObject({ action: 'CREATE', representative: false });
      // Neither the claim id nor the representative is ever in the payload.
      const raw = JSON.stringify(history.body);
      expect(raw).not.toContain(claim.id);
      expect(raw).not.toContain(rep.email);
      expect(raw).not.toContain(`rep@${host}`);
    });
  });

  describe('profile mark and "confirm still current"', () => {
    const detail = async (slug: string, token?: string) => {
      const req = http().get(`/companies/${slug}`);
      if (token) req.set(auth(token));
      return (await req.expect(200)).body as {
        representation: { since: string; lastConfirmedAt: string | null } | null;
        viewerClaim: { id: string; lastConfirmedAt: string | null; canConfirm: boolean } | null;
        company: { partnerOnly?: boolean };
      };
    };

    it('is null with no claim, a pending request, a revoked, banned or suspended claim', async () => {
      const admin = await f.user('ADMIN');
      const viewer = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      expect((await detail(co.slug, viewer.token)).representation).toBeNull();

      const requester = await f.user('USER');
      await f.prisma.companyClaim.create({
        data: { userId: requester.id, companyId: co.id, method: 'MANUAL', note: 'x'.repeat(30) },
      });
      expect((await detail(co.slug)).representation).toBeNull();

      const revoked = await f.user('USER');
      await claims.verify(await start(revoked.token, co.slug, `a@${host}`));
      expect((await detail(co.slug)).representation).not.toBeNull();
      const revokedClaim = (await claimFor(revoked.id, co.id))!;
      await http().post(`/admin/claims/${revokedClaim.id}/revoke`).set(auth(admin.token)).expect(201);
      expect((await detail(co.slug)).representation).toBeNull();

      const banned = await f.user('USER');
      await claims.verify(await start(banned.token, co.slug, `b@${host}`));
      expect((await detail(co.slug)).representation).not.toBeNull();
      await f.prisma.user.update({ where: { id: banned.id }, data: { bannedAt: new Date() } });
      expect((await detail(co.slug)).representation).toBeNull();
      await f.prisma.user.update({ where: { id: banned.id }, data: { bannedAt: null } });

      expect((await detail(co.slug)).representation).not.toBeNull();
      await f.prisma.company.update({ where: { id: co.id }, data: { domain: domain() } });
      expect((await detail(co.slug)).representation).toBeNull(); // suspended
    });

    it('is null on a signed-out partner-only stub, and shown signed in', async () => {
      const rep = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host, partnerOnly: true, partnerFields: ['domain'] });
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));
      const stub = await detail(co.slug);
      expect(stub.company.partnerOnly).toBe(true);
      expect(stub.representation).toBeNull();
      expect(stub.viewerClaim).toBeNull();
      const other = await f.user('USER');
      expect((await detail(co.slug, other.token)).representation).not.toBeNull();
    });

    it('two active claims: since is the earlier, lastConfirmedAt the later', async () => {
      const host = domain();
      const co = await f.company({ domain: host });
      const a = await f.user('USER');
      const b = await f.user('USER');
      await claims.verify(await start(a.token, co.slug, `a@${host}`));
      await claims.verify(await start(b.token, co.slug, `b@${host}`));
      const ca = (await claimFor(a.id, co.id))!;
      const cb = (await claimFor(b.id, co.id))!;
      await f.prisma.companyClaim.update({
        where: { id: ca.id },
        data: { verifiedAt: new Date('2026-01-01'), lastConfirmedAt: new Date('2026-03-01') },
      });
      await f.prisma.companyClaim.update({
        where: { id: cb.id },
        data: { verifiedAt: new Date('2026-02-01'), lastConfirmedAt: new Date('2026-04-01') },
      });
      expect((await detail(co.slug)).representation).toEqual({
        since: new Date('2026-01-01').toISOString(),
        lastConfirmedAt: new Date('2026-04-01').toISOString(),
      });
    });

    it('confirm: 403 without a claim, then once a day; no revision and no Company write', async () => {
      const rep = await f.user('USER');
      const other = await f.user('USER');
      const host = domain();
      const co = await f.company({ domain: host });
      await http().post(`/companies/${co.slug}/claim/confirm`).set(auth(rep.token)).expect(403);
      await claims.verify(await start(rep.token, co.slug, `rep@${host}`));

      const view = await detail(co.slug, rep.token);
      expect(view.viewerClaim).toMatchObject({ lastConfirmedAt: null, canConfirm: true });
      expect((await detail(co.slug, other.token)).viewerClaim).toBeNull();
      expect((await detail(co.slug)).viewerClaim).toBeNull();

      const before = await f.prisma.company.findUniqueOrThrow({ where: { id: co.id } });
      const revisionsBefore = await f.prisma.revision.count({ where: { companyId: co.id } });
      const res = await http()
        .post(`/companies/${co.slug}/claim/confirm`)
        .set(auth(rep.token))
        .expect(200);
      expect(typeof res.body.lastConfirmedAt).toBe('string');
      await http().post(`/companies/${co.slug}/claim/confirm`).set(auth(rep.token)).expect(429);
      await http().post(`/companies/${co.slug}/claim/confirm`).set(auth(other.token)).expect(403);

      const after = await f.prisma.company.findUniqueOrThrow({ where: { id: co.id } });
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
      expect(await f.prisma.revision.count({ where: { companyId: co.id } })).toBe(revisionsBefore);

      const confirmed = await detail(co.slug, rep.token);
      expect(confirmed.viewerClaim).toMatchObject({ canConfirm: false, lastConfirmedAt: res.body.lastConfirmedAt });
      expect(confirmed.representation?.lastConfirmedAt).toBe(res.body.lastConfirmedAt);
      // The mark never names the representative.
      expect(JSON.stringify(await detail(co.slug))).not.toContain(`rep@${host}`);
    });
  });

  describe('manual requests', () => {
    const note = 'I am the CFO; my name is on the team page linked below.';
    const ask = (token: string, slug: string, body: Record<string, unknown>) =>
      http().post(`/companies/${slug}/claim/request`).set(auth(token)).send(body);

    it('validates the note, the link and the attestation', async () => {
      const u = await f.user('USER');
      const co = await f.company();
      await ask(u.token, co.slug, { note: 'too short', authorised: true }).expect(400);
      await ask(u.token, co.slug, { note, evidenceUrl: 'not a url', authorised: true }).expect(400);
      await ask(u.token, co.slug, { note }).expect(400);
      const res = await ask(u.token, co.slug, {
        note,
        evidenceUrl: 'https://example.org/team',
        authorised: true,
      }).expect(201);
      expect(res.body).toMatchObject({ method: 'MANUAL', status: 'pending', email: null });
      // A second open request for the same company is a 409.
      await ask(u.token, co.slug, { note, authorised: true }).expect(409);
    });

    it('caps open requests per account', async () => {
      const u = await f.user('USER');
      for (let i = 0; i < 3; i++) {
        const co = await f.company();
        await ask(u.token, co.slug, { note, authorised: true }).expect(201);
      }
      const extra = await f.company();
      await ask(u.token, extra.slug, { note, authorised: true }).expect(429);
    });

    it('approve activates and labels pending rows; twice changes nothing; reject ends', async () => {
      const admin = await f.user('ADMIN');
      const u = await f.user('USER');
      const co = await f.company({ domain: '' });
      const roundId = (
        await http()
          .post(`/companies/${co.slug}/rounds`)
          .set(auth(u.token))
          .send({ name: 'Seed', date: '2025-06-01', amountUsd: 1, investors: [], attested: true })
          .expect(201)
      ).body.id as string;
      const req = (await ask(u.token, co.slug, { note, authorised: true }).expect(201)).body;
      createdClaimIds.push(req.id);
      await http().post(`/admin/claims/${req.id}/approve`).set(auth(u.token)).expect(403);

      const approved = await http()
        .post(`/admin/claims/${req.id}/approve`)
        .set(auth(admin.token))
        .expect(201);
      expect(approved.body).toMatchObject({ status: 'active', verifiedBy: admin.name });
      const stamp = (await f.prisma.companyClaim.findUniqueOrThrow({ where: { id: req.id } })).verifiedAt;
      expect((await f.prisma.fundingRound.findUniqueOrThrow({ where: { id: roundId } })).claimId).toBe(req.id);
      const sentBefore = notices.length;
      await http().post(`/admin/claims/${req.id}/approve`).set(auth(admin.token)).expect(201);
      expect((await f.prisma.companyClaim.findUniqueOrThrow({ where: { id: req.id } })).verifiedAt).toEqual(stamp);
      expect(notices.length).toBe(sentBefore);
      // An active claim refuses another request.
      await ask(u.token, co.slug, { note, authorised: true }).expect(409);

      // A manual claim survives a domain change.
      await f.prisma.company.update({ where: { id: co.id }, data: { domain: domain() } });
      expect(await activeClaimIds(f.prisma)).toContain(req.id);

      const v = await f.user('USER');
      const other = (await ask(v.token, co.slug, { note, authorised: true }).expect(201)).body;
      const rejected = await http()
        .post(`/admin/claims/${other.id}/reject`)
        .set(auth(admin.token))
        .send({ note: 'The page does not name you.' })
        .expect(201);
      expect(rejected.body).toMatchObject({ status: 'ended', endReason: 'rejected' });
      expect(notices.at(-1)).toMatchObject({ to: v.email });
      expect(notices.at(-1)!.event).toContain('The page does not name you.');
      // A rejection can't be approved afterwards.
      const after = await http().post(`/admin/claims/${other.id}/approve`).set(auth(admin.token)).expect(201);
      expect(after.body.status).toBe('ended');
    });

    it('the admin list is paged by status and the nav count matches', async () => {
      const admin = await f.user('ADMIN');
      const count = async () =>
        (await http().get('/admin/claims/count').set(auth(admin.token)).expect(200)).body.pending as number;
      const before = await count();
      const u = await f.user('USER');
      const co = await f.company();
      const req = (await ask(u.token, co.slug, { note, authorised: true }).expect(201)).body;
      expect(await count()).toBe(before + 1);

      const page = await http().get('/admin/claims?status=pending').set(auth(admin.token)).expect(200);
      expect(page.body).toMatchObject({ page: 1, pageSize: 25, total: before + 1 });
      expect(page.body.items.length).toBeLessThanOrEqual(25);
      await http().get('/admin/claims?status=bogus').set(auth(admin.token)).expect(400);
      await http().get('/admin/claims').set(auth(u.token)).expect(403);

      await http().post(`/admin/claims/${req.id}/reject`).set(auth(admin.token)).send({}).expect(201);
      expect(await count()).toBe(before);
      const ended = await http().get('/admin/claims?status=ended').set(auth(admin.token)).expect(200);
      expect(ended.body.total).toBeGreaterThan(0);
    });
  });

  it('activeClaimIds and isActiveClaim agree on every fixture claim', async () => {
    const rows = await f.prisma.companyClaim.findMany({
      where: { companyId: { in: f.companies } },
      include: { user: true, company: true },
    });
    expect(rows.length).toBeGreaterThan(5);
    const sql = new Set(await activeClaimIds(f.prisma));
    for (const row of rows) {
      expect([row.id, sql.has(row.id)]).toEqual([row.id, isActiveClaim(row, row.company)]);
    }
  });
});
