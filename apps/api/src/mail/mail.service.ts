import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import {
  loadTemplate,
  render,
  TEMPLATE_NAMES,
  type TemplateName,
  type TemplateVars,
} from './templates';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly siteUrl: string;
  /** Read once at boot, so a missing file crashes startup, not the first reset. */
  private readonly templates = new Map(TEMPLATE_NAMES.map((n) => [n, loadTemplate(n)]));

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('MAIL_FROM', 'Capbase <onboarding@resend.dev>');
    this.siteUrl = config.get<string>('SITE_URL', 'http://localhost:3001');
  }

  /** Forgot-password link. Never throws — the endpoint answers the same either way. */
  sendPasswordResetEmail(to: string, name: string, link: string): Promise<void> {
    return this.deliver('password-reset', to, { NAME: name, LINK: link }, link);
  }

  /** Email-confirmation link. Never throws — mail failure must not fail auth. */
  sendVerificationEmail(to: string, name: string, link: string): Promise<void> {
    return this.deliver('verify-email', to, { NAME: name, LINK: link }, link);
  }

  /** Welcome email. Never throws — mail failure must not fail auth. */
  sendWelcomeEmail(to: string, name: string): Promise<void> {
    return this.deliver('welcome', to, { NAME: name, SITE_URL: this.siteUrl });
  }

  /** Render and send one template. Never throws — mail failure must not fail the request. */
  private async deliver<T extends TemplateName>(
    name: T,
    to: string,
    vars: TemplateVars<T>,
    /** Logged instead of sending when Resend is off. A link is a live credential,
     *  so it is only echoed where nobody else reads the logs. */
    devLink?: string,
  ): Promise<void> {
    if (!this.resend) {
      const detail = devLink && process.env.NODE_ENV !== 'production' ? `: ${devLink}` : '';
      this.logger.log(`RESEND_API_KEY not set — skipping ${name} email to ${to}${detail}`);
      return;
    }
    try {
      const { subject, html, text } = render(name, this.templates.get(name)!, vars);
      // Resend reports API failures (bad key, unverified domain) in the result, not by throwing.
      const { error } = await this.resend.emails.send({ from: this.from, to, subject, html, text });
      if (error) {
        this.logger.error(`Resend rejected ${name} email to ${to}: ${error.name} — ${error.message}`);
        return;
      }
      this.logger.log(`${name} email sent to ${to}`);
    } catch (err) {
      this.logger.error(
        `Failed to send ${name} email to ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
