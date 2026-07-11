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
