import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('MAIL_FROM', 'Capbase <onboarding@resend.dev>');
  }

  /** Forgot-password link. Never throws — the endpoint answers the same either way. */
  async sendPasswordResetEmail(to: string, name: string, link: string): Promise<void> {
    if (!this.resend) {
      // The link is a live credential: only echo it where nobody else reads the logs.
      const detail = process.env.NODE_ENV === 'production' ? '' : `: ${link}`;
      this.logger.log(`RESEND_API_KEY not set — skipping reset email to ${to}${detail}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Reset your Capbase password',
        text: [
          `Hi ${name},`,
          '',
          'Someone asked to reset the password for this Capbase account. If that was you,',
          'open this link within the next hour to choose a new one:',
          '',
          link,
          '',
          "If it wasn't you, ignore this email — your password stays as it is.",
          '',
          '— The Capbase team',
        ].join('\n'),
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send password reset email to ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Welcome email on registration. Never throws — mail failure must not fail auth. */
  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    if (!this.resend) {
      this.logger.log(`RESEND_API_KEY not set — skipping welcome email to ${to}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Welcome to Capbase',
        text: [
          `Hi ${name},`,
          '',
          'Welcome to Capbase — the open, crowdsourced company and funding database.',
          'Contribute a company, round, or person to unlock full profiles for 30 days.',
          '',
          '— The Capbase team',
        ].join('\n'),
      });
      this.logger.log(`Welcome email sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send welcome email to ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
