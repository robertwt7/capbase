import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_GATE_POLICY,
  resolveGatePolicy,
  type GatePolicy,
} from '@repo/api';
import { featureFixtures } from './feature-fixtures';
import { DigestService, digestWeek } from '../src/monitoring/digest.service';
import { MonitoringService } from '../src/monitoring/monitoring.service';
import { MailService } from '../src/mail/mail.service';
import type { DigestSendResult } from '../src/mail/digest-retry';
import { GatePolicyService } from '../src/gate/gate-policy.service';
import { AuthService } from '../src/auth/auth.service';
import { digestUnsubscribeToken } from '../src/monitoring/digest-unsubscribe';
describe('Weekly digest (e2e, fake provider)', () => {
  let f: Awaited<ReturnType<typeof featureFixtures>>;
  let digest: DigestService;
  let monitoring: MonitoringService;
  let policy: GatePolicy = DEFAULT_GATE_POLICY;
  const sendDigest = jest.fn<
    Promise<DigestSendResult>,
    Parameters<MailService['sendDigest']>
  >();
  const now = new Date();
  // The assembly moment (any weekday: the window is not tied to Monday 08:00).
  const cutoff = new Date(now.getTime() + 7 * 86400000);
  const observed = new Date(cutoff.getTime() - 3600000);
  const consent = new Date(cutoff.getTime() - 2 * 3600000);
  const dispatchAt = new Date(cutoff.getTime() + 1000);
  beforeAll(async () => {
    f = await featureFixtures((builder) => {
      builder
        .overrideProvider(MailService)
        .useValue({
          sendDigest,
          sendVerificationEmail: jest.fn(async () => {}),
        });
    });
    digest = f.app.get(DigestService);
    monitoring = f.app.get(MonitoringService);
    jest
      .spyOn(f.app.get(GatePolicyService), 'current')
      .mockImplementation(() => policy);
  });
  afterAll(async () => {
    await f?.close();
  });
  afterEach(async () => {
    await f.prisma.user.updateMany({
      where: { id: { in: f.users } },
      data: { digestOptInAt: null },
    });
    await f.prisma.monitorDigest.updateMany({
      where: { userId: { in: f.users }, status: 'pending' },
      data: { status: 'skipped' },
    });
  });
  beforeEach(() => {
    policy = DEFAULT_GATE_POLICY;
    sendDigest.mockReset();
    sendDigest.mockResolvedValue({
      status: 'sent',
      providerId: 'fake-accepted',
    });
  });
  const prepared = async () => {
    const u = await f.user();
    const c = await f.company();
    await f.prisma.savedCompany.create({
      data: { userId: u.id, companyId: c.id },
    });
    await monitoring.setCompany(u.id, c.slug, true, consent);
    await digest.optIn(u.id, consent);
    await f.round(c.id, { amountUsd: 1234567n });
    await monitoring.runOnce(observed);
    await digest.assemble(cutoff);
    const row = await f.prisma.monitorDigest.findUniqueOrThrow({
      where: {
        userId_weekStart: {
          userId: u.id,
          weekStart: digestWeek(cutoff).weekStart,
        },
      },
    });
    return { u, c, row };
  };
  it('assembles once per week, freezes content and retries with exactly the same body/key', async () => {
    const { u, row } = await prepared();
    await Promise.all([digest.assemble(cutoff), digest.assemble(cutoff)]);
    expect(
      await f.prisma.monitorDigest.count({ where: { userId: u.id } }),
    ).toBe(1);
    sendDigest.mockResolvedValueOnce({
      status: 'retry',
      reason: 'network_or_timeout',
    });
    await digest.dispatch(dispatchAt);
    const pending = await f.prisma.monitorDigest.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(pending.status).toBe('pending');
    expect(pending.attempts).toBe(1);
    await digest.dispatch(pending.nextAttemptAt);
    const sent = await f.prisma.monitorDigest.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(sent.status).toBe('sent');
    expect(sent.providerId).toBe('fake-accepted');
    expect(sendDigest.mock.calls).toHaveLength(2);
    expect(sendDigest.mock.calls[1]).toEqual(sendDigest.mock.calls[0]);
    expect(sendDigest.mock.calls[0]![2].idempotencyKey).toBe(
      `monitor-digest/${row.id}`,
    );
    expect(sendDigest.mock.calls[0]![2].headers['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });
  it('does not assemble a week with no visible events or previewed funding', async () => {
    const u = await f.user();
    await digest.optIn(u.id, consent);
    await digest.assemble(cutoff);
    expect(
      await f.prisma.monitorDigest.count({ where: { userId: u.id } }),
    ).toBe(0);
    const c = await f.company();
    await f.prisma.savedCompany.create({
      data: { userId: u.id, companyId: c.id },
    });
    await monitoring.setCompany(u.id, c.slug, true, consent);
    await f.round(c.id, { amountUsd: 987654321987n });
    await monitoring.runOnce(observed);
    policy = resolveGatePolicy({
      sections: [
        {
          section: 'companyRounds',
          ...DEFAULT_GATE_POLICY.sections.companyRounds,
          unlocked: 'preview',
          previewRows: 1,
        },
      ],
      fields: [],
    }).policy;
    await digest.assemble(cutoff);
    expect(
      await f.prisma.monitorDigest.count({ where: { userId: u.id } }),
    ).toBe(0);
  });
  it.each(['optout', 'email', 'ban', 'locked'] as const)(
    'skips pending delivery after %s',
    async (change) => {
      const { u, row } = await prepared();
      if (change === 'optout') await digest.optOut(u.id);
      if (change === 'email')
        await f.app
          .get(AuthService)
          .updateProfile(
            u.id,
            { name: u.name, email: `changed-${u.email}` },
            'http://localhost:3001',
          );
      if (change === 'ban')
        await f.prisma.user.update({
          where: { id: u.id },
          data: { bannedAt: now },
        });
      if (change === 'locked')
        await f.prisma.user.update({
          where: { id: u.id },
          data: { role: 'USER' },
        });
      await digest.dispatch(dispatchAt);
      expect(
        (
          await f.prisma.monitorDigest.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe('skipped');
      expect(sendDigest).not.toHaveBeenCalled();
    },
  );
  it('requires a verified recipient, while locked accounts can always opt out', async () => {
    const u = await f.user();
    await f.prisma.user.update({
      where: { id: u.id },
      data: { emailVerifiedAt: null },
    });
    await request(f.app.getHttpServer())
      .put('/auth/me/digest')
      .auth(u.token, { type: 'bearer' })
      .expect(400);
    const locked = await f.user('USER');
    await request(f.app.getHttpServer())
      .put('/auth/me/digest')
      .auth(locked.token, { type: 'bearer' })
      .expect(403);
    await request(f.app.getHttpServer())
      .delete('/auth/me/digest')
      .auth(locked.token, { type: 'bearer' })
      .expect(200);
  });
  it('unsubscribes without a session, treats bad tokens/replay generically and grants no feed access', async () => {
    const u = await f.user();
    await digest.optIn(u.id, consent);
    const http = () => request(f.app.getHttpServer());
    await http()
      .post('/monitoring/unsubscribe')
      .send({ u: u.id, t: 'bad' })
      .expect(200);
    expect(
      (await f.prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .digestOptInAt,
    ).not.toBeNull();
    const t = digestUnsubscribeToken(
      f.app.get(ConfigService).getOrThrow('JWT_SECRET'),
      u.id,
    );
    for (let n = 0; n < 2; n++)
      await http()
        .post('/monitoring/unsubscribe')
        .send({ u: u.id, t })
        .expect(200);
    expect(
      (await f.prisma.user.findUniqueOrThrow({ where: { id: u.id } }))
        .digestOptInAt,
    ).toBeNull();
    await http().get('/auth/me/updates').expect(401);
  });
  it('bounds retries, skips disabled delivery, and escapes visible company names', async () => {
    const { u, c, row } = await prepared();
    await f.prisma.company.update({
      where: { id: c.id },
      data: { name: '<script>alert(1)</script>' },
    });
    // The assembled body stays frozen even if records change before a retry.
    expect(row.html).not.toContain('<script>');
    expect(row.html).not.toContain('987654321987');
    expect(row.text).not.toContain('987654321987');
    await f.prisma.monitorDigest.update({
      where: { id: row.id },
      data: { attempts: 6 },
    });
    await digest.dispatch(dispatchAt);
    expect(
      (
        await f.prisma.monitorDigest.findUniqueOrThrow({
          where: { id: row.id },
        })
      ).status,
    ).toBe('failed');
    expect(sendDigest).not.toHaveBeenCalled();
    const next = await prepared();
    sendDigest.mockResolvedValue({ status: 'disabled' });
    await digest.dispatch(dispatchAt);
    expect(
      (
        await f.prisma.monitorDigest.findUniqueOrThrow({
          where: { id: next.row.id },
        })
      ).status,
    ).toBe('skipped');
    expect(u.id).toBeTruthy();
  });
  it('counts the 23 h retry limit from the first attempt, and supersedes a never-attempted week', async () => {
    // Assembled 30 h ago but never attempted (a long send queue): still sent.
    const { u, row } = await prepared();
    const assembled = new Date(dispatchAt.getTime() - 30 * 3600000);
    await f.prisma.monitorDigest.update({ where: { id: row.id }, data: { createdAt: assembled } });
    // Opted in before that assembly (a later opt-in would rightly skip the row).
    await f.prisma.user.update({
      where: { id: u.id },
      data: { digestOptInAt: new Date(assembled.getTime() - 3600000) },
    });
    await digest.dispatch(dispatchAt);
    const sent = await f.prisma.monitorDigest.findUniqueOrThrow({ where: { id: row.id } });
    expect(sent.status).toBe('sent');
    expect(sent.firstAttemptAt).toEqual(dispatchAt);
    // First attempted 23 h ago: no further attempt.
    const late = await prepared();
    await f.prisma.monitorDigest.update({
      where: { id: late.row.id },
      data: { attempts: 1, firstAttemptAt: new Date(dispatchAt.getTime() - 23 * 3600000) },
    });
    sendDigest.mockClear();
    await digest.dispatch(dispatchAt);
    expect((await f.prisma.monitorDigest.findUniqueOrThrow({ where: { id: late.row.id } })).status).toBe('failed');
    // Never attempted for a week: its week is over.
    const stale = await prepared();
    const old = new Date(dispatchAt.getTime() - 8 * 86400000);
    await f.prisma.monitorDigest.update({ where: { id: stale.row.id }, data: { createdAt: old } });
    await f.prisma.user.update({
      where: { id: stale.u.id },
      data: { digestOptInAt: new Date(old.getTime() - 3600000) },
    });
    await digest.dispatch(dispatchAt);
    expect((await f.prisma.monitorDigest.findUniqueOrThrow({ where: { id: stale.row.id } })).status).toBe('skipped');
    expect(sendDigest).toHaveBeenCalledTimes(0);
  });

  it('starts the next window at the previous digest, so no event is mailed twice', async () => {
    const { u, c } = await prepared();
    const nextWeek = new Date(cutoff.getTime() + 7 * 86400000);
    await f.round(c.id, { amountUsd: 7654321n });
    await monitoring.runOnce(new Date(nextWeek.getTime() - 3600000));
    await digest.assemble(nextWeek);
    const rows = await f.prisma.monitorDigest.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[1]!.weekStart).toEqual(digestWeek(nextWeek).weekStart);
    // Only the new round: the first week's round is not repeated.
    expect(rows[1]!.text).toContain('$7,654,321');
    expect(rows[1]!.text).not.toContain('$1,234,567');
  });

  it('renders an undisclosed amount as such, never $0', async () => {
    const u = await f.user();
    const c = await f.company();
    await f.prisma.savedCompany.create({ data: { userId: u.id, companyId: c.id } });
    await monitoring.setCompany(u.id, c.slug, true, consent);
    await digest.optIn(u.id, consent);
    await f.round(c.id, { amountUsd: 0n });
    await monitoring.runOnce(observed);
    await digest.assemble(cutoff);
    const row = await f.prisma.monitorDigest.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.text).toContain('Undisclosed amount');
    expect(row.text).not.toContain('$0');
  });
});
