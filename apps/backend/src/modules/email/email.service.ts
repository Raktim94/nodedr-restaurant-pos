import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends email through the operator's own SMTP server (any provider: Gmail
 * app password, SES, Mailgun SMTP, a local relay…). Configured by
 * environment so no credentials live in the database:
 *   SMTP_URL   smtp://user:pass@host:587   (smtps:// for implicit TLS)
 *   SMTP_FROM  "My Cafe <hello@mycafe.com>"
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null | undefined;

  constructor(private readonly config: ConfigService) {}

  private get from(): string {
    return this.config.get<string>('SMTP_FROM') ?? '';
  }

  isConfigured(): boolean {
    return !!this.config.get<string>('SMTP_URL') && !!this.from;
  }

  private getTransport(): Transporter {
    if (this.transporter === undefined) {
      const url = this.config.get<string>('SMTP_URL');
      this.transporter = url && this.from ? createTransport(url) : null;
    }
    if (!this.transporter)
      throw new Error('Email is not set up: set SMTP_URL and SMTP_FROM');
    return this.transporter;
  }

  async send(mail: OutgoingEmail): Promise<void> {
    await this.getTransport().sendMail({ from: this.from, ...mail });
  }

  /** Sends to many recipients one at a time, returning how many went through. */
  async sendEach(
    mails: OutgoingEmail[],
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const mail of mails) {
      try {
        await this.send(mail);
        sent++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Email to ${mail.to} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { sent, failed };
  }
}
